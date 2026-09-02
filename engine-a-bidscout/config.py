"""중앙 설정. 자격증명이 하나도 없어도 import 되어야 합니다 (OFFLINE 모드)."""
from __future__ import annotations

import os
from datetime import timedelta, timezone

KST = timezone(timedelta(hours=9))


def _b(key: str, default: str = "0") -> bool:
    return os.getenv(key, default).strip().lower() in {"1", "true", "yes", "on"}


# ── 실행 모드 ────────────────────────────────────────────────────────────
# OFFLINE=1  : 외부 호출 없음. fixture 공고 + 휴리스틱 스코어러 + 콘솔 알림 + 메모리 저장.
#              자격증명 0개로 전체 파이프라인을 그대로 돌려 볼 수 있습니다.
OFFLINE = _b("OFFLINE")

# ── 나라장터 ─────────────────────────────────────────────────────────────
DATA_GO_KR_KEY = os.getenv("DATA_GO_KR_KEY", "")

# 조달청이 엔드포인트를 이전하면서 두 계열이 공존합니다. 순서대로 프로브합니다.
G2B_BASES = [
    b.strip() for b in os.getenv(
        "G2B_BASES",
        "https://apis.data.go.kr/1230000/ad/BidPublicInfoService,"
        "https://apis.data.go.kr/1230000/BidPublicInfoService",
    ).split(",") if b.strip()
]

# 카테고리별 오퍼레이션 후보. PPSSrch(나라장터 검색조건) 우선, 실패 시 기본형.
G2B_OPS: dict[str, list[str]] = {
    "용역": ["getBidPblancListInfoServcPPSSrch", "getBidPblancListInfoServc"],
    "물품": ["getBidPblancListInfoThngPPSSrch", "getBidPblancListInfoThng"],
    "공사": ["getBidPblancListInfoCnstwkPPSSrch", "getBidPblancListInfoCnstwk"],
}

PAGE_ROWS = int(os.getenv("PAGE_ROWS", "100"))
MAX_PAGES = int(os.getenv("MAX_PAGES", "5"))          # 안전 상한 (최대 500건/카테고리)
HTTP_TIMEOUT = float(os.getenv("HTTP_TIMEOUT", "30"))

# ── Gemini ──────────────────────────────────────────────────────────────
GCP_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "")
GCP_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "global")
SCORE_MODEL = os.getenv("SCORE_MODEL", "gemini-2.5-flash-lite")
DRAFT_MODEL = os.getenv("DRAFT_MODEL", "gemini-3.1-pro-preview")
SCORE_BATCH = int(os.getenv("SCORE_BATCH", "20"))

# ── 판정 기준 ────────────────────────────────────────────────────────────
MIN_SCORE = int(os.getenv("MIN_SCORE", "70"))
MIN_WIN_PROB = int(os.getenv("MIN_WIN_PROB", "30"))
MAX_DRAFTS = int(os.getenv("MAX_DRAFTS", "3"))
BUDGET_FLOOR = int(os.getenv("BUDGET_FLOOR", "30000000"))      # 3천만원 미만은 제외
BUDGET_CEIL = int(os.getenv("BUDGET_CEIL", "3000000000"))      # 30억 초과는 단독 수행 불가

# ── 인증·알림 ────────────────────────────────────────────────────────────
RUN_TOKEN = os.getenv("RUN_TOKEN", "")
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
MAIL_TO = os.getenv("MAIL_TO", "")

# ── 저장소 ───────────────────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")


def backend_summary() -> dict:
    """지금 어떤 백엔드로 도는지. /healthz 가 이걸 그대로 노출합니다."""
    if OFFLINE:
        return {"mode": "OFFLINE", "source": "fixture", "scorer": "heuristic-stub",
                "store": "memory", "notify": "console"}
    return {
        "mode": "LIVE",
        "source": "g2b-api" if DATA_GO_KR_KEY else "MISSING_KEY",
        "scorer": f"gemini:{SCORE_MODEL}" if GCP_PROJECT else "MISSING_PROJECT",
        "store": "supabase" if (SUPABASE_URL and SUPABASE_KEY) else "firestore",
        "notify": "smtp" if (SMTP_USER and SMTP_PASS) else "console",
    }


# ── STARGATE 수행 역량 (스코어링 프롬프트에 그대로 주입) ─────────────────
CAPABILITY = os.getenv(
    "CAPABILITY_PROFILE",
    "STARGATE 데모 환경입니다. 실제 운영에서는 비공개 수행역량 프로필을 주입하십시오.",
)

KEYWORDS_POSITIVE = [
    "데이터", "대시보드", "시각화", "플랫폼", "홈페이지", "웹사이트", "정보시스템",
    "인공지능", "AI", "분석", "통계", "GIS", "공간", "지도", "도시", "부동산",
    "교육", "콘텐츠", "구축", "고도화", "유지관리", "실태조사", "연구용역", "컨설팅",
    "디지털", "정보화", "빅데이터", "포털", "시스템",
]

KEYWORDS_NEGATIVE = [
    "청소", "경비", "급식", "차량임차", "시설관리", "조경", "방역", "인쇄", "제작설치",
    "토목", "건축공사", "전기공사", "소방", "승강기", "냉난방", "석면", "폐기물",
]
