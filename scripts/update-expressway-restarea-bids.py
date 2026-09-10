#!/usr/bin/env python3
"""Collect public Korea Expressway Corporation rest-area opportunities.

Sources intentionally limited to public pages. The collector keeps the seeded
manual opportunities as a fallback, then enriches them with fresh EX notices
and rest-area store recruitment posts.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "strategy" / "expressway-restarea-bid" / "data" / "opportunities.json"
KST = timezone(timedelta(hours=9))

SOURCES = [
    ("한국도로공사 공지사항", "https://www.ex.co.kr/portal/biz/bbs/layout1/selectBoardList.do?bbsId=BBSMSTR_000000000182"),
    ("한국도로공사 보도자료", "https://www.ex.co.kr/portal/biz/bbs/layout1/selectBoardList.do?bbsId=BBSMSTR_000000000183"),
    ("한국도로공사 매장현황", "https://ex.co.kr/portal/biz/svarFnd/selectFndPbanList.do"),
]
KEYWORDS = (
    "휴게소", "주유소", "매장", "임대", "운영", "입찰", "공모", "모집",
    "전기차", "충전", "편의점", "푸드코트", "커피", "창업", "서비스",
    "모니터링", "용역", "통신", "정보", "시스템", "스마트", "매각"
)


def category(title: str) -> str:
    if any(k in title for k in ("전기차", "충전", "스마트", "통신", "정보", "시스템")):
        return "전기차·스마트시설"
    if any(k in title for k in ("창업", "매장", "임대", "편의점", "푸드", "커피")):
        return "전문매장·임대"
    if any(k in title for k in ("용역", "모니터링", "조사")):
        return "용역·데이터"
    return "공사·용역·물품"


def score(title: str, cat: str) -> int:
    s = 60
    if "휴게소" in title: s += 12
    if any(k in title for k in ("입찰", "공모", "모집", "임대")): s += 10
    if cat in ("용역·데이터", "전기차·스마트시설"): s += 8
    if any(k in title for k in ("데이터", "정보", "시스템", "모니터링")): s += 6
    return min(s, 98)


def fit(cat: str) -> str:
    if cat == "용역·데이터": return "직접"
    if cat == "전문매장·임대": return "파트너형"
    if cat == "전기차·스마트시설": return "컨소시엄"
    return "직접·컨소시엄"


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def collect_page(source_name: str, url: str) -> list[dict]:
    r = requests.get(url, timeout=20, headers={"User-Agent": "STARGATE-public-opportunity-radar/1.0"})
    r.raise_for_status()
    r.encoding = r.apparent_encoding or r.encoding
    soup = BeautifulSoup(r.text, "html.parser")
    found: list[dict] = []
    for a in soup.find_all("a", href=True):
        title = clean(a.get_text(" ", strip=True))
        if len(title) < 5 or not any(k in title for k in KEYWORDS):
            continue
        href = urljoin(url, a["href"])
        cat = category(title)
        found.append({
            "title": title,
            "organization": "한국도로공사",
            "category": cat,
            "region": "전국/공고참조",
            "deadline": "공고참조",
            "status": "확인필요",
            "score": score(title, cat),
            "fit": fit(cat),
            "reason": "공개 공공홈페이지에서 자동 수집. 세부 참가자격·마감일·실적요건은 원문 확인 필요.",
            "url": href,
            "source": source_name,
        })
    return found


def main() -> None:
    payload = json.loads(DATA.read_text(encoding="utf-8")) if DATA.exists() else {"opportunities": []}
    seeds = payload.get("opportunities", [])
    collected: list[dict] = []
    status = {}
    for name, url in SOURCES:
        try:
            items = collect_page(name, url)
            collected.extend(items)
            status[name] = f"ok:{len(items)}"
        except Exception as exc:
            status[name] = f"error:{type(exc).__name__}"

    merged = {}
    for item in seeds + collected:
        key = (item.get("title", ""), item.get("url", ""))
        merged[key] = item
    items = sorted(merged.values(), key=lambda x: int(x.get("score", 0)), reverse=True)[:250]

    out = {
        "updatedAt": datetime.now(KST).isoformat(timespec="seconds"),
        "sourceStatus": status,
        "opportunities": items,
    }
    DATA.parent.mkdir(parents=True, exist_ok=True)
    DATA.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"saved {len(items)} opportunities -> {DATA}")


if __name__ == "__main__":
    main()
