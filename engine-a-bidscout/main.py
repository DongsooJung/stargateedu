"""
BidScout — 입찰·RFP 자동 수주 엔진 (Cloud Run service).

Google Cloud API:
  Vertex AI (Gemini) · Cloud Run · Cloud Scheduler · Firestore · Secret Manager

엔드포인트:
  GET  /healthz            현재 백엔드 구성 확인
  POST /run                수집 → 판정 → 초안 → 알림      (X-Run-Token 필요)
  POST /ingest             위시켓 등 수동 공고 투입 후 판정 (X-Run-Token 필요)
  POST /outcome            낙찰/탈락 결과 기록             (X-Run-Token 필요)
  GET  /scored             최근 판정 목록                  (X-Run-Token 필요)
"""
from __future__ import annotations

import logging
import os

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import config as C
import pipeline
import sources
import store
from gemini_scorer import score_notices, draft_proposal

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s | %(message)s",
)
log = logging.getLogger("bidscout")

app = FastAPI(title="BidScout", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[x.strip() for x in os.getenv(
        "ALLOW_ORIGINS",
        "https://www.stargateedu.co.kr,https://stargateedu.co.kr",
    ).split(",") if x.strip()],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Run-Token"],
)


def auth(token: str) -> None:
    # OFFLINE 로컬 실행에서는 토큰이 없어도 통과시킵니다.
    if C.OFFLINE and not C.RUN_TOKEN:
        return
    if not C.RUN_TOKEN or token != C.RUN_TOKEN:
        raise HTTPException(status_code=401, detail="invalid X-Run-Token")


@app.get("/healthz")
def healthz():
    return {"ok": True, "version": app.version, **C.backend_summary()}


class RunRequest(BaseModel):
    days_back: int = Field(default=1, ge=1, le=30)
    categories: list[str] = Field(default_factory=lambda: ["용역"])
    dry_run: bool = False
    max_drafts: int | None = Field(default=None, ge=0, le=10)
    notify: bool = True


@app.post("/run")
def run(req: RunRequest, x_run_token: str = Header(default="")):
    auth(x_run_token)
    bad = [c for c in req.categories if c not in C.G2B_OPS]
    if bad:
        raise HTTPException(status_code=400,
                            detail=f"지원하지 않는 카테고리: {bad}. 가능: {list(C.G2B_OPS)}")
    return pipeline.run(
        categories=req.categories, days_back=req.days_back,
        dry_run=req.dry_run, max_drafts=req.max_drafts, notify_result=req.notify,
    )


class ManualNotice(BaseModel):
    title: str
    url: str = ""
    agency: str = ""
    budget: int | str = 0
    method: str = ""
    deadline: str = ""
    region: str = ""
    description: str = ""
    source: str = "wishket"


class IngestRequest(BaseModel):
    notices: list[ManualNotice]
    draft: bool = True                # 권고 건에 대해 제안서 초안까지 생성할지
    dry_run: bool = False


@app.post("/ingest")
def ingest(req: IngestRequest, x_run_token: str = Header(default="")):
    """
    위시켓·프리랜서 마켓처럼 공개 API 가 없는 공고를 붙여넣어 같은 판정에 태웁니다.
    크롤링하지 않습니다 — 본인이 열람한 공고 내용을 직접 넣는 방식입니다.
    """
    auth(x_run_token)
    if not req.notices:
        raise HTTPException(status_code=400, detail="notices 가 비어 있습니다.")

    try:
        rows = [sources.normalize_manual(n.model_dump()) for n in req.notices]
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    scored = score_notices(rows)
    scored.sort(key=lambda x: (x["score"], x["win_prob"]), reverse=True)
    if not req.dry_run:
        store.save_scored(scored)

    drafts = []
    if req.draft:
        for item in scored[:C.MAX_DRAFTS]:
            if not item.get("go"):
                break
            try:
                d = draft_proposal(item)
            except Exception as e:                        # noqa: BLE001
                log.exception("draft failed: %s", e)
                continue
            drafts.append(d)
            if not req.dry_run:
                store.save_proposal(item["bid_no"], d)

    return {
        "ingested": len(rows),
        "scored": len(scored),
        "go": sum(1 for s in scored if s.get("go")),
        "results": [{"bid_no": s["bid_no"], "title": s["title"], "score": s["score"],
                     "win_prob": s["win_prob"], "go": s.get("go"),
                     "reason": s.get("reason"), "risk": s.get("risk")} for s in scored],
        "drafts": [{"bid_no": d["bid_no"], "markdown": d["markdown"]} for d in drafts],
    }


class OutcomeRequest(BaseModel):
    bid_no: str
    outcome: str                       # proposed | submitted | won | lost | skipped


@app.post("/outcome")
def outcome(req: OutcomeRequest, x_run_token: str = Header(default="")):
    auth(x_run_token)
    try:
        hit = store.record_outcome(req.bid_no, req.outcome)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not hit:
        raise HTTPException(status_code=404, detail=f"{req.bid_no} 판정 기록이 없습니다.")
    return {"bid_no": req.bid_no, "outcome": req.outcome}


@app.get("/scored")
def scored(limit: int = 50, min_score: int = 0, x_run_token: str = Header(default="")):
    auth(x_run_token)
    return {"items": store.list_scored(limit=min(limit, 200), min_score=min_score)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8080")))
