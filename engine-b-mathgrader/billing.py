"""
크레딧 원장 + 토스페이먼츠 결제 승인.

과금 모델:
  - 신규 가입 무료 3회 (FREE_GRANT)
  - 크레딧 팩: 10회 3,000원 / 50회 12,000원 / 200회 39,000원
  - 학원 월정액: 별도 계약 (plan='academy', 크레딧 무제한 + 월 청구)

Firestore 트랜잭션으로 차감하므로 동시 요청에서 크레딧이 음수가 되지 않습니다.
"""
from __future__ import annotations

import os
import base64
import logging
import threading
from datetime import datetime, timedelta, timezone

import httpx
log = logging.getLogger("mathgrader.billing")
KST = timezone(timedelta(hours=9))

OFFLINE = os.getenv("OFFLINE", "0").strip().lower() in {"1", "true", "yes", "on"}
if not OFFLINE:
    from google.cloud import firestore
    db = firestore.Client()
else:
    firestore = None
    db = None

TOSS_SECRET = os.getenv("TOSS_SECRET_KEY", "")       # test_sk_... / live_sk_...
TOSS_CONFIRM = "https://api.tosspayments.com/v1/payments/confirm"

FREE_GRANT = int(os.getenv("FREE_GRANT", "3"))

# orderId 접두사 → (크레딧, 정가). 금액 위변조를 막기 위해 서버가 정가를 강제합니다.
PACKS = {
    "P10":  (10, 3000),
    "P50":  (50, 12000),
    "P200": (200, 39000),
}

_demo_users: dict[str, dict] = {}
_demo_lock = threading.Lock()


def _auth_header() -> dict:
    token = base64.b64encode(f"{TOSS_SECRET}:".encode()).decode()
    return {"Authorization": f"Basic {token}", "Content-Type": "application/json"}


def ensure_user(uid: str) -> dict:
    if OFFLINE:
        with _demo_lock:
            return _demo_users.setdefault(uid, {
                "uid": uid,
                "credits": FREE_GRANT,
                "plan": "demo",
                "created_at": datetime.now(KST).isoformat(),
                "graded_total": 0,
            }).copy()
    ref = db.collection("users").document(uid)
    snap = ref.get()
    if snap.exists:
        return snap.to_dict()
    doc = {
        "uid": uid,
        "credits": FREE_GRANT,
        "plan": "free",
        "created_at": datetime.now(KST).isoformat(),
        "graded_total": 0,
    }
    ref.set(doc)
    return doc


def _consume(tx, ref, n: int) -> int:
    snap = ref.get(transaction=tx)
    if not snap.exists:
        raise ValueError("user not found")
    data = snap.to_dict()
    if data.get("plan") == "academy":                 # 월정액은 차감하지 않음
        tx.update(ref, {"graded_total": firestore.Increment(n)})
        return -1
    cur = int(data.get("credits", 0))
    if cur < n:
        raise PermissionError("insufficient credits")
    tx.update(ref, {
        "credits": cur - n,
        "graded_total": firestore.Increment(n),
    })
    return cur - n


def consume_credit(uid: str, n: int = 1) -> int:
    """차감 후 잔액을 반환합니다. 월정액이면 -1."""
    if OFFLINE:
        with _demo_lock:
            user = _demo_users.setdefault(uid, {
                "uid": uid, "credits": FREE_GRANT, "plan": "demo",
                "created_at": datetime.now(KST).isoformat(), "graded_total": 0,
            })
            if int(user["credits"]) < n:
                raise PermissionError("insufficient credits")
            user["credits"] -= n
            user["graded_total"] += n
            return int(user["credits"])
    ensure_user(uid)
    ref = db.collection("users").document(uid)
    return firestore.transactional(_consume)(db.transaction(), ref, n)


def refund_credit(uid: str, n: int = 1) -> None:
    """채점 실패 시 되돌립니다."""
    if OFFLINE:
        with _demo_lock:
            if uid in _demo_users:
                _demo_users[uid]["credits"] += n
        return
    db.collection("users").document(uid).update({"credits": firestore.Increment(n)})


def get_balance(uid: str) -> dict:
    u = ensure_user(uid)
    return {"credits": u.get("credits", 0), "plan": u.get("plan", "free"),
            "graded_total": u.get("graded_total", 0)}


async def confirm_payment(payment_key: str, order_id: str, amount: int, uid: str) -> dict:
    """
    토스페이먼츠 결제 승인 → 크레딧 적립.
    orderId 규칙: "{PACK}-{uid}-{timestamp}"  예) P50-u_abc123-1756700000
    """
    if OFFLINE:
        raise PermissionError("데모 모드에서는 결제를 승인하지 않습니다.")
    if not TOSS_SECRET:
        raise RuntimeError("TOSS_SECRET_KEY is not configured")

    pack_code = order_id.split("-", 1)[0]
    if pack_code not in PACKS:
        raise ValueError(f"unknown pack: {pack_code}")
    credits, price = PACKS[pack_code]

    if amount != price:                                # 프론트에서 금액을 바꿔 보낸 경우
        raise PermissionError(f"amount mismatch: expected {price}, got {amount}")

    order_ref = db.collection("orders").document(order_id)
    if order_ref.get().exists:                         # 중복 승인 방지
        return {"status": "ALREADY_CONFIRMED", "credits_added": 0}

    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            TOSS_CONFIRM,
            headers=_auth_header(),
            json={"paymentKey": payment_key, "orderId": order_id, "amount": amount},
        )
    if r.status_code != 200:
        log.error("toss confirm failed %s %s", r.status_code, r.text)
        raise RuntimeError(r.json().get("message", "payment confirm failed"))

    payment = r.json()

    order_ref.set({
        "order_id": order_id,
        "uid": uid,
        "pack": pack_code,
        "credits": credits,
        "amount": amount,
        "payment_key": payment_key,
        "method": payment.get("method"),
        "approved_at": payment.get("approvedAt"),
        "receipt_url": (payment.get("receipt") or {}).get("url"),
        "raw_status": payment.get("status"),
    })
    ensure_user(uid)
    db.collection("users").document(uid).update({"credits": firestore.Increment(credits)})

    return {
        "status": payment.get("status"),
        "credits_added": credits,
        "balance": get_balance(uid)["credits"],
        "receipt_url": (payment.get("receipt") or {}).get("url"),
    }
