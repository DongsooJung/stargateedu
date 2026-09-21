#!/usr/bin/env python3
"""Refresh Yongsan Station retail / leasing opportunity data from public sources."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "strategy" / "yongsan-retail-bid" / "data" / "opportunities.json"
KST = timezone(timedelta(hours=9))
UA = {"User-Agent": "STARGATE-Yongsan-Retail-Radar/1.0 (+public-web-monitor)"}\nCOLLECTOR_VERSION = "2026-09-21.3"

KORAIL_SOURCES = [
    ("코레일유통 전문점 모집", "https://www.korailretail.com/board/boardList.do?boardTypeNum=4"),
    ("코레일유통 상업시설 모집", "https://www.korailretail.com/board/boardList.do?boardTypeNum=46"),
    ("코레일유통 입찰공고", "https://www.korailretail.com/bbs/selectBbsList.do?bbsId=BBSMSTR_000000000027"),
]
HDC_ENTER = "https://www.hdc-iparkmall.com/report/enter/main.do"
YONGSAN_DEV = "https://www.seoul.go.kr/news/news_report.do?nttNo=446896"

DETAIL_TRIGGERS = ("계약종료", "신규개발", "전문점", "운영자", "상업시설", "임대", "입찰", "모집", "구축")
YONGSAN_TERMS = ("용산역", "용산 역", "용산")
DATE_RE = re.compile(r"(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})")


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def category(title: str) -> str:
    if any(k in title for k in ("공사", "구축", "설비", "리뉴얼")):
        return "시설·구축"
    if any(k in title for k in ("광고", "매체")):
        return "광고"
    if any(k in title for k in ("임대", "상업시설", "전문점", "매장", "운영")):
        return "점포·운영"
    return "입찰·공모"


def score(title: str, detail: str = "") -> int:
    text = title + " " + detail
    s = 65
    if "용산역" in text: s += 15
    elif "용산" in text: s += 10
    if any(k in text for k in ("모집", "입찰", "임대", "운영자")): s += 8
    if any(k in text for k in ("전문점", "상업시설", "매장")): s += 5
    if "3번출구" in text: s += 4
    return min(s, 99)


def parse_date(text: str) -> str:
    m = DATE_RE.search(text)
    if not m:
        return ""
    y, mo, d = m.groups()
    return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"


def fetch(url: str) -> tuple[BeautifulSoup, str]:
    r = requests.get(url, timeout=20, headers=UA)
    r.raise_for_status()
    r.encoding = r.apparent_encoding or r.encoding
    return BeautifulSoup(r.text, "html.parser"), r.text


def detail_mentions_yongsan(url: str) -> tuple[bool, str]:
    try:
        soup, _ = fetch(url)
        text = clean(soup.get_text(" ", strip=True))
        return any(k in text for k in YONGSAN_TERMS), text[:2400]
    except Exception:
        return False, ""


def collect_korail(source: str, url: str) -> list[dict]:
    soup, _ = fetch(url)
    found = []
    seen = set()
    opportunity_terms = ("전문점", "상업시설", "입찰", "모집", "임대", "운영", "공사", "구축", "매장")

    def add_item(title: str, context: str, href: str, contract_watch: bool = False) -> None:
        title = clean(title)
        context = clean(context)
        if not title or title in seen:
            return
        seen.add(title)

        dates = DATE_RE.findall(context)
        normalized_dates = [
            f"{int(y):04d}-{int(mo):02d}-{int(d):02d}" for y, mo, d in dates
        ]
        published = normalized_dates[0] if normalized_dates else "공고참조"
        deadline = normalized_dates[-1] if len(normalized_dates) > 1 else "원문확인"

        if contract_watch:
            found.append({
                "title": title,
                "organization": "코레일유통",
                "category": "계약종료 사전공개",
                "location": "용산 포함여부 확인",
                "published": published,
                "deadline": "분기 사전공개",
                "status": "용산포함 검증필요",
                "score": 72,
                "fit": "모니터링",
                "amount": "원문/첨부 확인",
                "contractTerm": "매장별 상이",
                "reason": "분기 계약종료 매장 사전공개입니다. 용산역 포함 여부는 공지 첨부파일을 최종 확인해야 하며, 이후 개별 모집공고 전환을 추적합니다.",
                "url": href,
                "source": source,
            })
            return

        found.append({
            "title": title,
            "organization": "코레일유통",
            "category": category(title),
            "location": "용산역",
            "published": published,
            "deadline": deadline,
            "status": "용산관련",
            "score": score(title, context),
            "fit": "직접·파트너형",
            "amount": "원문확인",
            "contractTerm": "원문확인",
            "reason": "코레일유통 공개 페이지의 텍스트에서 용산 관련 공고를 자동 탐지했습니다. 금액·계약기간·참가자격은 첨부파일 원문을 최종 확인해야 합니다.",
            "url": href,
            "source": source,
        })

    # 1) Direct Yongsan mentions. Text-node scan is resilient to JS/onclick boards
    # where the title is not exposed as a normal href.
    for node in soup.find_all(string=re.compile("용산")):
        text = clean(str(node))
        if len(text) < 4:
            continue
        parent = node.parent
        container = node.find_parent(["tr", "li", "article", "section", "div"]) or parent
        context = clean(container.get_text(" ", strip=True)) if container else text
        candidate = text if any(k in text for k in opportunity_terms) else context
        if not any(k in candidate for k in opportunity_terms):
            continue
        # Avoid generic address/footer strings.
        if "서울특별시 용산구" in candidate and not any(k in candidate for k in ("역", "전문점", "상업시설", "입찰", "공사")):
            continue

        href = url
        a = parent if getattr(parent, "name", None) == "a" else parent.find_parent("a") if parent else None
        if not a and container:
            a = container.find("a", href=True)
        if a and a.get("href"):
            raw_href = clean(a.get("href", ""))
            if raw_href and not raw_href.lower().startswith("javascript:") and raw_href != "#":
                href = urljoin(url, raw_href)

        # Prefer the direct title node when it already looks like a notice title.
        title = text if len(text) >= 8 else candidate
        add_item(title, context, href)

    # 2) Quarterly contract-expiry notices are kept as watch items even before
    # their attachment can be parsed, so Yongsan inclusion is not missed.
    for node in soup.find_all(string=re.compile("계약종료")):
        text = clean(str(node))
        if "4분기" not in text and "분기" not in text:
            continue
        parent = node.parent
        container = node.find_parent(["tr", "li", "article", "section", "div"]) or parent
        context = clean(container.get_text(" ", strip=True)) if container else text
        href = url
        a = parent if getattr(parent, "name", None) == "a" else parent.find_parent("a") if parent else None
        if not a and container:
            a = container.find("a", href=True)
        if a and a.get("href"):
            raw_href = clean(a.get("href", ""))
            if raw_href and not raw_href.lower().startswith("javascript:") and raw_href != "#":
                href = urljoin(url, raw_href)
        add_item(text, context, href, contract_watch=True)

    return found


def standing_items() -> list[dict]:
    return [
        {
            "title": "HDC아이파크몰 용산점 입점·대관 제안",
            "organization": "HDC아이파크몰",
            "category": "민간 입점",
            "location": "용산역 연결 아이파크몰",
            "published": "상시",
            "deadline": "상시/협의",
            "status": "상시제안",
            "score": 82,
            "fit": "직접제안",
            "amount": "개별협의",
            "contractTerm": "개별협의",
            "reason": "아이파크몰 공식 입점·대관 채널. 팝업·브랜드·공간 제안의 민간 진입 경로입니다.",
            "url": HDC_ENTER,
            "source": "HDC아이파크몰 공식",
        },
        {
            "title": "용산국제업무지구 상업·리테일 개발 파이프라인",
            "organization": "서울시·코레일·SH",
            "category": "개발사업",
            "location": "용산구 한강로3가 일대",
            "published": "개발계획",
            "deadline": "단계별",
            "status": "장기감시",
            "score": 78,
            "fit": "파트너·컨소시엄",
            "amount": "사업별",
            "contractTerm": "사업별",
            "reason": "기반시설·민간필지 개발 단계에 따라 리테일 MD, 스마트공간, 데이터·운영 사업 기회를 추적합니다.",
            "url": YONGSAN_DEV,
            "source": "서울시 공식",
        },
    ]


def main() -> None:
    old = {"opportunities": []}
    if DATA.exists():
        try:
            old = json.loads(DATA.read_text(encoding="utf-8"))
        except Exception:
            pass

    collected = []
    source_status = {}
    for name, url in KORAIL_SOURCES:
        try:
            items = collect_korail(name, url)
            collected.extend(items)
            source_status[name] = f"ok:{len(items)}"
        except Exception as exc:
            source_status[name] = f"error:{type(exc).__name__}"

    source_status["HDC아이파크몰 입점/대관"] = "standing"
    source_status["용산국제업무지구"] = "standing"

    merged = {}
    # If every Korail source fails, retain prior collected Korail records.
    if not any(str(v).startswith("ok:") for v in source_status.values()):
        for item in old.get("opportunities", []):
            if item.get("organization") == "코레일유통":
                merged[(item.get("title", ""), item.get("url", ""))] = item

    for item in collected + standing_items():
        merged[(item.get("title", ""), item.get("url", ""))] = item

    items = sorted(
        merged.values(),
        key=lambda x: (int(x.get("score", 0)), str(x.get("published", ""))),
        reverse=True,
    )[:150]

    out = {
        "updatedAt": datetime.now(KST).isoformat(timespec="seconds"),
        "sourceStatus": source_status,
        "opportunities": items,
    }
    DATA.parent.mkdir(parents=True, exist_ok=True)
    DATA.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"saved {len(items)} Yongsan opportunities -> {DATA}")


if __name__ == "__main__":
    main()
