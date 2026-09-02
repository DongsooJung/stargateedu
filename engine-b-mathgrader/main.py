"""
MathGrader — 서술형 답안 사진 → 단계별 AI 채점 (유료).
STARGATE MATH 서술형 풀이 AI 에 과금 게이트를 붙인 Cloud Run 서비스.

Google Cloud API 사용:
  - Vertex AI (Gemini multimodal) : 손글씨 답안 채점
  - Cloud Run                     : 서버리스 API
  - Firestore                     : 크레딧 원장 · 주문 · 채점 이력
  - Cloud Storage (선택)           : 답안 이미지 보관
  - Secret Manager                : 토스 시크릿 키

엔드포인트:
  POST /grade            멀티파트(image, problem, rubric, max_score) → 채점 결과, 크레딧 1 차감
  GET  /credits          잔액 조회
  POST /payments/confirm 토스 결제 승인 → 크레딧 적립
  GET  /history          최근 채점 이력
"""
from __future__ import annotations

import os
import io
import uuid
import logging
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import grader
import billing

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("mathgrader")
KST = timezone(timedelta(hours=9))

app = FastAPI(title="STARGATE MathGrader")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOW_ORIGINS", "https://www.stargateedu.co.kr").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

OFFLINE = os.getenv("OFFLINE", "0").strip().lower() in {"1", "true", "yes", "on"}
if not OFFLINE:
    from google.cloud import firestore
    db = firestore.Client()
else:
    firestore = None
    db = None
_demo_grades: list[dict] = []
MAX_IMAGE_MB = int(os.getenv("MAX_IMAGE_MB", "8"))
GCS_BUCKET = os.getenv("GCS_BUCKET", "")          # 비우면 이미지 보관 안 함


def current_uid(x_user_id: str = Header(default="")) -> str:
    """
    운영에서는 Firebase Authentication / Identity Platform ID 토큰 검증으로 교체하십시오.
    MVP 단계에서는 프론트가 발급한 익명 uid 를 헤더로 받습니다.
    """
    if not x_user_id or len(x_user_id) < 6:
        raise HTTPException(status_code=401, detail="X-User-Id 헤더가 필요합니다.")
    return x_user_id


@app.get("/healthz")
def healthz():
    return {
        "ok": True,
        "mode": "DEMO" if OFFLINE else "LIVE",
        "grader": "demo-stub" if OFFLINE else f"vertex:{grader.MODEL}",
        "payments": "disabled" if OFFLINE else "toss",
        "ts": datetime.now(KST).isoformat(),
    }


@app.get("/credits")
def credits(uid: str = Depends(current_uid)):
    return billing.get_balance(uid)


@app.post("/grade")
async def grade_answer(
    image: UploadFile = File(...),
    problem: str = Form(...),
    rubric: str = Form(default=""),
    max_score: int = Form(default=10),
    uid: str = Depends(current_uid),
):
    if image.content_type not in {"image/jpeg", "image/png", "image/webp", "image/heic"}:
        raise HTTPException(status_code=415, detail="jpg, png, webp 이미지를 올려 주십시오.")

    data = await image.read()
    if len(data) > MAX_IMAGE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"{MAX_IMAGE_MB}MB 이하로 올려 주십시오.")

    # 1) 선차감 — 실패 시 되돌립니다.
    try:
        balance = billing.consume_credit(uid, 1)
    except PermissionError:
        raise HTTPException(status_code=402, detail="크레딧이 부족합니다. 충전 후 이용해 주십시오.")

    try:
        result = grader.grade(
            image_bytes=data,
            mime_type=image.content_type,
            problem_text=problem,
            rubric=rubric or None,
            max_score=max_score,
        )
    except Exception as e:                                # noqa: BLE001
        billing.refund_credit(uid, 1)
        log.exception("grading failed: %s", e)
        raise HTTPException(status_code=502, detail="채점에 실패했습니다. 크레딧은 복구되었습니다.")

    # 2) 읽을 수 없는 이미지는 과금하지 않습니다.
    if not result.get("readable", True):
        billing.refund_credit(uid, 1)
        return {
            "readable": False,
            "message": "답안을 읽을 수 없습니다. 밝은 곳에서 답안지 전체가 나오게 다시 찍어 주십시오.",
            "charged": False,
            "balance": billing.get_balance(uid)["credits"],
        }

    grade_id = uuid.uuid4().hex[:12]
    usage = result.pop("_usage", {})

    if GCS_BUCKET:
        _upload(data, f"answers/{uid}/{grade_id}", image.content_type)

    grade_record = {
        "grade_id": grade_id,
        "uid": uid,
        "problem": problem[:2000],
        "total_score": result.get("total_score"),
        "max_score": result.get("max_score"),
        "first_error": result.get("first_error"),
        "misconception": result.get("misconception"),
        "created_at": datetime.now(KST).isoformat(),
        "usage": usage,
    }
    if OFFLINE:
        _demo_grades.insert(0, grade_record)
        del _demo_grades[100:]
    else:
        db.collection("grades").document(grade_id).set(grade_record)

    return {"grade_id": grade_id, "charged": True, "balance": balance, **result}


@app.get("/history")
def history(limit: int = 20, uid: str = Depends(current_uid)):
    if OFFLINE:
        return {"items": [x for x in _demo_grades if x["uid"] == uid][:min(limit, 100)]}
    docs = (
        db.collection("grades")
        .where(filter=firestore.FieldFilter("uid", "==", uid))
        .order_by("created_at", direction=firestore.Query.DESCENDING)
        .limit(min(limit, 100))
        .stream()
    )
    return {"items": [d.to_dict() for d in docs]}


class ConfirmBody(BaseModel):
    paymentKey: str
    orderId: str
    amount: int


@app.post("/payments/confirm")
async def confirm(body: ConfirmBody, uid: str = Depends(current_uid)):
    # orderId 안의 uid 와 헤더 uid 가 일치해야 합니다.
    parts = body.orderId.split("-")
    if len(parts) < 3 or parts[1] != uid:
        raise HTTPException(status_code=403, detail="주문 정보가 일치하지 않습니다.")
    try:
        return await billing.confirm_payment(body.paymentKey, body.orderId, body.amount, uid)
    except PermissionError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:                                # noqa: BLE001
        log.exception("confirm failed: %s", e)
        raise HTTPException(status_code=502, detail="결제 승인에 실패했습니다.")


@app.get("/packs")
def packs():
    return {
        "packs": [
            {"code": c, "credits": cr, "price": p, "unit": round(p / cr)}
            for c, (cr, p) in billing.PACKS.items()
        ],
        "free_grant": billing.FREE_GRANT,
        "payments_enabled": not OFFLINE,
        "mode": "DEMO" if OFFLINE else "LIVE",
    }


def _upload(data: bytes, path: str, content_type: str) -> None:
    try:
        from google.cloud import storage
        storage.Client().bucket(GCS_BUCKET).blob(path).upload_from_file(
            io.BytesIO(data), content_type=content_type
        )
    except Exception as e:                                # noqa: BLE001
        log.warning("gcs upload skipped: %s", e)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8080")))
