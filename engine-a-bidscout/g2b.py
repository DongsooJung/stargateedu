"""
나라장터 입찰공고 클라이언트.

조달청이 엔드포인트를 이전하면서 두 계열이 공존하고, 카테고리별 오퍼레이션도
PPSSrch 계열과 기본 계열이 갈립니다. 어느 조합이 살아 있는지 키 없이는 확정할 수 없어
**첫 호출 때 후보를 순서대로 프로브하고 성공한 조합을 캐시**합니다.

응답 필드도 오퍼레이션마다 조금씩 다르므로 정규화 계층을 둡니다.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Iterable

import httpx

import config as C

log = logging.getLogger("bidscout.g2b")

# (category) -> (base, op)  성공한 조합 캐시
_RESOLVED: dict[str, tuple[str, str]] = {}


class G2BError(RuntimeError):
    pass


# ── 필드 정규화 ──────────────────────────────────────────────────────────
# 오퍼레이션·계열에 따라 이름이 달라지는 필드는 후보를 순서대로 찾습니다.
FIELD_MAP = {
    "bid_no":         ["bidNtceNo"],
    "bid_ord":        ["bidNtceOrd"],
    "title":          ["bidNtceNm"],
    "agency":         ["ntceInsttNm"],
    "demand_agency":  ["dminsttNm"],
    "budget":         ["presmptPrce", "asignBdgtAmt", "bdgtAmt"],
    "method":         ["cntrctCnclsMthdNm", "bidMethdNm"],
    "posted_at":      ["bidNtceDt", "rgstDt"],
    "deadline":       ["bidClseDt", "bidBeginDt", "opengDt"],
    "url":            ["bidNtceDtlUrl", "bidNtceUrl"],
    "region":         ["prtcptPsblRgnNm", "rgnLmtBidLocplcJdgmBssCd"],
    "industry":       ["indstrytyNm", "indstrytyLmtYn"],
}


def _pick(item: dict, keys: list[str]) -> str:
    for k in keys:
        v = item.get(k)
        if v not in (None, "", "null"):
            return str(v).strip()
    return ""


def to_int(v) -> int:
    try:
        return int(float(str(v).replace(",", "").strip() or 0))
    except (TypeError, ValueError):
        return 0


def normalize(item: dict, category: str) -> dict:
    out = {k: _pick(item, keys) for k, keys in FIELD_MAP.items()}
    out["budget"] = to_int(out["budget"])
    out["category"] = category
    out["source"] = "g2b"
    if not out["url"] and out["bid_no"]:
        out["url"] = (
            "https://www.g2b.go.kr/pt/menu/selectSubFrame.do?framesrc="
            f"/pt/menu/frameTgong.do?url=https://www.g2b.go.kr:8101/ep/invitation/"
            f"publish/bidInfoDtl.do?bidno={out['bid_no']}"
        )
    return out


# ── 호출 ─────────────────────────────────────────────────────────────────
def _params(key: str, page: int, bgn: str, end: str) -> dict:
    return {
        "serviceKey": key,
        "pageNo": page,
        "numOfRows": C.PAGE_ROWS,
        "inqryDiv": 1,                      # 1 = 공고게시일시 기준
        "inqryBgnDt": bgn,
        "inqryEndDt": end,
        "type": "json",
    }


def _parse(payload: dict) -> tuple[list[dict], int, str]:
    """(items, totalCount, resultMsg) 반환. 실패 시 G2BError."""
    resp = payload.get("response") or {}
    header = resp.get("header") or {}
    code = str(header.get("resultCode", "")).strip()
    msg = str(header.get("resultMsg", "")).strip()

    if code and code not in {"00", "0"}:
        raise G2BError(f"{code} {msg}")

    body = resp.get("body") or {}
    items = body.get("items")
    if isinstance(items, dict):                      # 단건일 때 dict
        items = items.get("item", items)
    if isinstance(items, dict):
        items = [items]
    if items is None:
        items = []
    return items, to_int(body.get("totalCount")), msg or code


def _fetch_page(client: httpx.Client, base: str, op: str,
                key: str, page: int, bgn: str, end: str) -> tuple[list[dict], int]:
    r = client.get(f"{base}/{op}", params=_params(key, page, bgn, end))
    if r.status_code != 200:
        raise G2BError(f"HTTP {r.status_code}")
    ctype = r.headers.get("content-type", "")
    if "json" not in ctype:
        # 인증키 오류는 XML 로 옵니다.
        snippet = r.text[:200].replace("\n", " ")
        raise G2BError(f"non-json response ({ctype}): {snippet}")
    return _parse(r.json())[:2]


def resolve_endpoint(category: str, key: str) -> tuple[str, str]:
    """살아 있는 (base, op) 조합을 찾습니다. 결과는 프로세스 수명 동안 캐시됩니다."""
    if category in _RESOLVED:
        return _RESOLVED[category]

    end = datetime.now(C.KST)
    bgn = end - timedelta(days=1)
    bgn_s, end_s = bgn.strftime("%Y%m%d0000"), end.strftime("%Y%m%d2359")

    errors: list[str] = []
    with httpx.Client(timeout=C.HTTP_TIMEOUT, follow_redirects=True) as client:
        for base in C.G2B_BASES:
            for op in C.G2B_OPS[category]:
                try:
                    _fetch_page(client, base, op, key, 1, bgn_s, end_s)
                except Exception as e:                    # noqa: BLE001
                    errors.append(f"{base.rsplit('/', 1)[-1]}/{op}: {e}")
                    continue
                log.info("resolved %s -> %s/%s", category, base, op)
                _RESOLVED[category] = (base, op)
                return base, op

    raise G2BError(
        f"'{category}' 조회 가능한 엔드포인트를 찾지 못했습니다.\n  - " + "\n  - ".join(errors)
    )


def fetch(category: str, days_back: int = 1, key: str | None = None,
          max_pages: int | None = None) -> list[dict]:
    """공고를 정규화된 dict 리스트로 반환합니다."""
    key = key or C.DATA_GO_KR_KEY
    if not key:
        raise G2BError("DATA_GO_KR_KEY 가 비어 있습니다. 공공데이터포털 Decoding 키를 넣으십시오.")

    base, op = resolve_endpoint(category, key)
    end = datetime.now(C.KST)
    bgn = end - timedelta(days=days_back)
    bgn_s, end_s = bgn.strftime("%Y%m%d0000"), end.strftime("%Y%m%d2359")

    rows: list[dict] = []
    limit = max_pages or C.MAX_PAGES
    with httpx.Client(timeout=C.HTTP_TIMEOUT, follow_redirects=True) as client:
        for page in range(1, limit + 1):
            items, total = _fetch_page(client, base, op, key, page, bgn_s, end_s)
            rows += [normalize(it, category) for it in items]
            if len(rows) >= total or len(items) < C.PAGE_ROWS:
                break

    log.info("g2b %s: %d rows (days_back=%d)", category, len(rows), days_back)
    return rows


def fetch_many(categories: Iterable[str], days_back: int = 1) -> tuple[list[dict], list[str]]:
    """여러 카테고리를 모읍니다. (rows, errors) — 한 카테고리가 실패해도 나머지는 진행합니다."""
    rows, errors = [], []
    for cat in categories:
        try:
            rows += fetch(cat, days_back)
        except Exception as e:                            # noqa: BLE001
            log.warning("fetch failed for %s: %s", cat, e)
            errors.append(f"{cat}: {e}")
    return rows, errors
