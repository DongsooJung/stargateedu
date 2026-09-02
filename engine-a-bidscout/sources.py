"""
공고 수집 소스와 사전 필터.

소스 3종:
  1. g2b      — 나라장터 공식 OpenAPI (LIVE)
  2. fixture  — 배선 검증용 표본 (OFFLINE). 모든 공고명에 [FIXTURE] 접두어.
  3. manual   — 위시켓·프리랜서 마켓처럼 공개 API가 없는 곳의 공고를 붙여넣어 투입
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import config as C
import g2b

log = logging.getLogger("bidscout.sources")

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "g2b_sample.json"


def load_fixture(categories: list[str] | None = None) -> list[dict]:
    data = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    rows = data["items"]
    if categories:
        rows = [r for r in rows if r["category"] in categories]
    return [dict(r) for r in rows]


def collect(categories: list[str], days_back: int) -> tuple[list[dict], list[str]]:
    if C.OFFLINE:
        rows = load_fixture(categories)
        log.info("OFFLINE: fixture %d rows", len(rows))
        return rows, []
    return g2b.fetch_many(categories, days_back)


# ── 수동 투입 (위시켓 등) ────────────────────────────────────────────────
def normalize_manual(raw: dict) -> dict:
    """
    최소 필드만 받습니다. title 은 필수, 나머지는 없으면 빈 값으로 둡니다.
    Gemini 는 없는 정보를 지어내지 않도록 프롬프트에 「미상」으로 전달됩니다.
    """
    title = (raw.get("title") or "").strip()
    if not title:
        raise ValueError("title 은 필수입니다.")
    bid_no = (raw.get("bid_no") or raw.get("id") or "").strip()
    if not bid_no:
        # 위시켓 URL 끝 숫자를 id 로 쓰거나, 제목 해시로 대체
        url = raw.get("url", "")
        tail = url.rstrip("/").rsplit("/", 1)[-1] if url else ""
        bid_no = f"M-{tail}" if tail.isdigit() else f"M-{abs(hash(title)) % 10**10}"
    return {
        "bid_no": bid_no,
        "bid_ord": "00",
        "title": title,
        "agency": (raw.get("agency") or raw.get("client") or "").strip(),
        "demand_agency": "",
        "budget": g2b.to_int(raw.get("budget")),
        "method": (raw.get("method") or "").strip(),
        "posted_at": (raw.get("posted_at") or "").strip(),
        "deadline": (raw.get("deadline") or "").strip(),
        "url": (raw.get("url") or "").strip(),
        "region": (raw.get("region") or "").strip(),
        "industry": (raw.get("industry") or "").strip(),
        "description": (raw.get("description") or "").strip()[:4000],
        "category": raw.get("category") or "용역",
        "source": raw.get("source") or "manual",
    }


# ── 사전 필터 ────────────────────────────────────────────────────────────
def prefilter(notices: list[dict], seen_fn=None) -> tuple[list[dict], dict]:
    """
    Gemini 호출 전에 명백히 무관한 건을 걸러 토큰을 아낍니다.
    (kept, stats) 를 반환합니다. stats 로 어느 규칙이 얼마나 잘랐는지 보입니다.
    """
    stats = {"total": len(notices), "seen": 0, "negative_kw": 0,
             "no_positive_kw": 0, "budget_low": 0, "budget_high": 0, "kept": 0}
    kept = []

    for n in notices:
        if seen_fn and seen_fn(n["bid_no"], n.get("bid_ord")):
            stats["seen"] += 1
            continue

        title = n.get("title", "")
        low = title.lower()

        if any(k in title for k in C.KEYWORDS_NEGATIVE):
            stats["negative_kw"] += 1
            continue
        # 수동 투입 건은 설명이 있으므로 키워드 게이트를 면제합니다.
        if n.get("source") != "manual" and not any(k.lower() in low for k in C.KEYWORDS_POSITIVE):
            stats["no_positive_kw"] += 1
            continue

        budget = n.get("budget", 0)
        if budget and budget < C.BUDGET_FLOOR:
            stats["budget_low"] += 1
            continue
        if budget and budget > C.BUDGET_CEIL:
            stats["budget_high"] += 1
            continue

        kept.append(n)

    stats["kept"] = len(kept)
    return kept, stats
