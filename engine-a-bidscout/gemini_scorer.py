"""
Vertex AI Gemini — 공고 적합도 스코어링 + 제안서 초안 생성.

비용 설계:
  - 스코어링   : gemini-2.5-flash-lite, 20건씩 배치 → 100건이 5회 호출
  - 제안서 초안 : gemini-3.1-pro-preview, 품질이 곧 수주율이므로 여기만 상위 모델

OFFLINE 모드에서는 Gemini 를 호출하지 않고 휴리스틱 스텁이 대신합니다.
스텁 결과에는 engine="heuristic-stub" 이 붙어 실제 판정과 절대 섞이지 않습니다.
"""
from __future__ import annotations

import json
import logging

import config as C

log = logging.getLogger("bidscout.gemini")

_client = None


def client():
    """google-genai 클라이언트를 최초 사용 시점에 만듭니다 (import 시 자격증명 불필요)."""
    global _client
    if _client is None:
        from google import genai
        if not C.GCP_PROJECT:
            raise RuntimeError("GOOGLE_CLOUD_PROJECT 가 비어 있습니다.")
        _client = genai.Client(vertexai=True, project=C.GCP_PROJECT, location=C.GCP_LOCATION)
    return _client


SCORE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "results": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "bid_no": {"type": "STRING"},
                    "score": {"type": "INTEGER", "description": "0-100 수주 적합도"},
                    "win_prob": {"type": "INTEGER", "description": "0-100 낙찰 가능성"},
                    "effort_mm": {"type": "NUMBER", "description": "예상 투입 man-month"},
                    "reason": {"type": "STRING", "description": "한국어 한 문장, 60자 이내"},
                    "risk": {"type": "STRING", "description": "가장 큰 리스크, 60자 이내"},
                    "go": {"type": "BOOLEAN", "description": "제안 착수 권고 여부"},
                },
                "required": ["bid_no", "score", "win_prob", "effort_mm", "reason", "risk", "go"],
            },
        }
    },
    "required": ["results"],
}

SCORE_INSTRUCTION = f"""당신은 소규모 데이터·AI 전문기업의 입찰 심사역입니다.
주어진 수행 역량과 공고 목록을 대조해 각 공고를 냉정하게 평가하십시오.

평가 원칙:
- 수행 역량과 직접 맞닿지 않으면 score 40 이하를 주십시오. 후하게 주지 마십시오.
- 결격 요건에 하나라도 걸리면 score 20 이하, go=false 로 두십시오.
- 추정가격이 5,000만원 미만이면 투입 대비 실익이 낮으므로 score 를 20점 감점하십시오.
- 추정가격 5억 이상이면 단독 수행이 어려우므로 win_prob 를 30 이하로 두십시오.
- 계약방법이 '일반경쟁'이면 win_prob 를 낮추고, '협상에의한계약'·'제한경쟁'이면 높이십시오.
- 정보가 미상인 항목은 추측하지 말고 그 불확실성을 risk 에 적으십시오.
- go 는 score >= {C.MIN_SCORE} 이고 win_prob >= {C.MIN_WIN_PROB} 일 때만 true 로 두십시오.
- reason 과 risk 는 각각 한국어 한 문장, 60자 이내."""

DRAFT_INSTRUCTION = """당신은 공공 IT·데이터 용역 제안서를 쓰는 실무 PM입니다.
주어진 공고 1건에 대해 바로 제출 가능한 수준의 제안서 초안을 한국어로 작성하십시오.

구조를 반드시 지키십시오:
1. 과업 이해 — 발주기관이 실제로 해결하려는 문제를 2~3문장으로 재정의
2. 제안 개요 — 우리가 무엇을 어떤 순서로 만드는지 3단계
3. 상세 수행방안 — 단계별 산출물과 사용 기술을 표로
4. 차별화 요소 — 유사 수행실적을 근거로 3가지
5. 추진일정 — 계약일 기준 주차별
6. 투입인력 — 역할과 M/M
7. 확인 필요사항 — 공고문만으로 판단 불가한 항목 3가지 (반드시 포함)

원칙:
- 공고문에 없는 수치·실적을 지어내지 마십시오. 모르는 값은 「(확인 필요)」로 표기하십시오.
- 형용사보다 산출물 이름과 동사를 쓰십시오.
- 존댓말, 짧은 문단, 명확한 동사."""


# ── 휴리스틱 스텁 (OFFLINE 전용) ─────────────────────────────────────────
_STUB_STRONG = ["데이터", "대시보드", "시각화", "분석", "AI", "인공지능", "GIS",
                "공간", "빅데이터", "공공데이터", "도시", "부동산", "통계"]
_STUB_MEDIUM = ["홈페이지", "웹", "포털", "콘텐츠", "교육", "고도화", "유지관리", "연구용역"]
_STUB_BLOCK = ["정보보호", "관제", "급식", "청소", "시설관리", "포장공사", "토목", "재구축 사업"]


def _heuristic(n: dict) -> dict:
    title = n.get("title", "")
    score = 35
    score += 14 * sum(1 for k in _STUB_STRONG if k in title)
    score += 7 * sum(1 for k in _STUB_MEDIUM if k in title)
    if any(k in title for k in _STUB_BLOCK):
        score = min(score, 18)

    b = n.get("budget", 0)
    if b and b < 50_000_000:
        score -= 20
    if b and b > 500_000_000:
        score -= 25

    method = n.get("method", "")
    win = 45 if "협상" in method or "제한" in method else 25
    if b and b > 500_000_000:
        win = min(win, 15)

    score = max(0, min(100, score))
    return {
        "bid_no": n["bid_no"],
        "score": score,
        "win_prob": max(0, min(100, win)),
        "effort_mm": round(max(0.5, (b or 50_000_000) / 90_000_000), 1),
        "reason": "휴리스틱 스텁 판정입니다. 실제 판정이 아닙니다.",
        "risk": "OFFLINE 모드 — Gemini 판정 미수행.",
        "go": score >= C.MIN_SCORE and win >= C.MIN_WIN_PROB,
        "engine": "heuristic-stub",
    }


# ── 스코어링 ─────────────────────────────────────────────────────────────
def score_notices(notices: list[dict], capability: str | None = None) -> list[dict]:
    """공고 목록에 판정 결과를 병합해 반환합니다."""
    if not notices:
        return []
    capability = capability or C.CAPABILITY

    if C.OFFLINE:
        log.warning("OFFLINE: 휴리스틱 스텁으로 스코어링합니다 (실제 판정 아님)")
        return [{**n, **_heuristic(n)} for n in notices]

    by_id = {n["bid_no"]: n for n in notices}
    merged: list[dict] = []

    for i in range(0, len(notices), C.SCORE_BATCH):
        chunk = notices[i:i + C.SCORE_BATCH]
        payload = [
            {
                "bid_no": n["bid_no"],
                "title": n["title"],
                "agency": n.get("agency") or "미상",
                "budget": n.get("budget") or "미상",
                "method": n.get("method") or "미상",
                "deadline": n.get("deadline") or "미상",
                "region": n.get("region") or "미상",
                **({"description": n["description"]} if n.get("description") else {}),
            }
            for n in chunk
        ]
        prompt = (
            f"{capability}\n\n"
            f"## 평가 대상 공고 {len(payload)}건\n"
            f"{json.dumps(payload, ensure_ascii=False, indent=1)}"
        )
        try:
            from google.genai import types
            resp = client().models.generate_content(
                model=C.SCORE_MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=SCORE_INSTRUCTION,
                    response_mime_type="application/json",
                    response_schema=SCORE_SCHEMA,
                    temperature=0.2,
                ),
            )
            results = json.loads(resp.text)["results"]
        except Exception as e:                            # noqa: BLE001
            log.exception("scoring batch %d-%d failed: %s", i, i + len(chunk), e)
            continue

        for r in results:
            base = by_id.get(r.get("bid_no"))
            if base:
                merged.append({**base, **r, "engine": f"gemini:{C.SCORE_MODEL}"})
            else:
                log.warning("unknown bid_no in response: %s", r.get("bid_no"))

    return merged


def draft_proposal(item: dict, capability: str | None = None) -> dict:
    capability = capability or C.CAPABILITY
    budget = item.get("budget") or 0

    if C.OFFLINE:
        md = (
            f"# [OFFLINE 스텁] {item['title']}\n\n"
            "OFFLINE 모드에서는 제안서를 생성하지 않습니다. "
            "`OFFLINE=0` 과 GCP 자격증명을 설정한 뒤 다시 실행하십시오.\n"
        )
        return {"bid_no": item["bid_no"], "title": item["title"], "score": item["score"],
                "url": item.get("url", ""), "deadline": item.get("deadline", ""),
                "markdown": md, "engine": "offline-stub"}

    prompt = (
        f"{capability}\n\n"
        "## 공고 정보\n"
        f"- 공고명: {item['title']}\n"
        f"- 공고번호: {item['bid_no']}\n"
        f"- 발주기관: {item.get('agency') or '미상'} / 수요기관: {item.get('demand_agency') or '미상'}\n"
        f"- 추정가격: {f'{budget:,}원' if budget else '미상'}\n"
        f"- 계약방법: {item.get('method') or '미상'}\n"
        f"- 참가가능지역: {item.get('region') or '미상'}\n"
        f"- 입찰마감: {item.get('deadline') or '미상'}\n"
        f"- 공고 URL: {item.get('url') or '미상'}\n"
        + (f"- 과업 설명:\n{item['description']}\n" if item.get("description") else "")
        + "\n## 사전 판정\n"
        f"- 적합도 {item['score']}점 / 낙찰 가능성 {item['win_prob']}%\n"
        f"- 판단 근거: {item['reason']}\n"
        f"- 식별된 리스크: {item['risk']}\n"
    )
    from google.genai import types
    resp = client().models.generate_content(
        model=C.DRAFT_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=DRAFT_INSTRUCTION,
            temperature=0.4,
            max_output_tokens=4096,
        ),
    )
    return {
        "bid_no": item["bid_no"],
        "title": item["title"],
        "score": item["score"],
        "url": item.get("url", ""),
        "deadline": item.get("deadline", ""),
        "markdown": resp.text,
        "engine": f"gemini:{C.DRAFT_MODEL}",
    }
