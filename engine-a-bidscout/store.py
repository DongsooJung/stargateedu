"""
저장 계층. 백엔드 3종을 같은 인터페이스로 감쌉니다.

  - memory    : OFFLINE 모드. 프로세스 메모리.
  - supabase  : SUPABASE_URL/KEY 가 있을 때
  - firestore : 그 외 (Cloud Run 기본)

라이브러리 import 는 실제로 그 백엔드를 쓸 때만 일어납니다.
"""
from __future__ import annotations

import logging
from datetime import datetime

import config as C

log = logging.getLogger("bidscout.store")

_backend: str = ""
_client = None
_mem_scored: dict[str, dict] = {}
_mem_proposal: dict[str, dict] = {}


def backend() -> str:
    global _backend, _client
    if _backend:
        return _backend
    if C.OFFLINE:
        _backend = "memory"
    elif C.SUPABASE_URL and C.SUPABASE_KEY:
        from supabase import create_client
        _client = create_client(C.SUPABASE_URL, C.SUPABASE_KEY)
        _backend = "supabase"
    else:
        from google.cloud import firestore
        _client = firestore.Client()
        _backend = "firestore"
    return _backend


def _key(bid_no: str, bid_ord: str | None) -> str:
    return f"{bid_no}-{bid_ord or '00'}"


def already_seen(bid_no: str, bid_ord: str | None = None) -> bool:
    k = _key(bid_no, bid_ord)
    try:
        b = backend()
        if b == "memory":
            return k in _mem_scored
        if b == "supabase":
            return bool(_client.table("bid_scored").select("id").eq("id", k).limit(1).execute().data)
        return _client.collection("bid_scored").document(k).get().exists
    except Exception as e:                                # noqa: BLE001
        log.warning("already_seen failed (%s) — 새 건으로 처리합니다", e)
        return False


def save_scored(items: list[dict]) -> int:
    if not items:
        return 0
    now = datetime.now(C.KST).isoformat()
    rows = [{
        "id": _key(it["bid_no"], it.get("bid_ord")),
        "bid_no": it["bid_no"],
        "title": it["title"],
        "agency": it.get("agency", ""),
        "budget": it.get("budget", 0),
        "method": it.get("method", ""),
        "deadline": it.get("deadline", ""),
        "url": it.get("url", ""),
        "category": it.get("category", ""),
        "source": it.get("source", ""),
        "score": it["score"],
        "win_prob": it["win_prob"],
        "effort_mm": it.get("effort_mm", 0),
        "reason": it.get("reason", ""),
        "risk": it.get("risk", ""),
        "go": it.get("go", False),
        "engine": it.get("engine", ""),
        "scored_at": now,
        "status": "new",              # new → proposed → submitted → won/lost/skipped
    } for it in items]

    try:
        b = backend()
        if b == "memory":
            for r in rows:
                _mem_scored[r["id"]] = r
        elif b == "supabase":
            _client.table("bid_scored").upsert(rows).execute()
        else:
            batch = _client.batch()
            for r in rows:
                batch.set(_client.collection("bid_scored").document(r["id"]), r)
            batch.commit()
        return len(rows)
    except Exception as e:                                # noqa: BLE001
        log.exception("save_scored failed: %s", e)
        return 0


def save_proposal(bid_no: str, draft: dict) -> None:
    row = {**draft, "created_at": datetime.now(C.KST).isoformat(), "status": "draft"}
    try:
        b = backend()
        if b == "memory":
            _mem_proposal[bid_no] = row
        elif b == "supabase":
            _client.table("bid_proposal").upsert({**row, "id": bid_no}).execute()
        else:
            _client.collection("bid_proposal").document(bid_no).set(row)
    except Exception as e:                                # noqa: BLE001
        log.exception("save_proposal failed: %s", e)


def record_outcome(bid_no: str, outcome: str) -> bool:
    """낙찰/탈락 결과를 되먹여 다음 스코어링 프롬프트 튜닝의 근거로 씁니다."""
    if outcome not in {"proposed", "submitted", "won", "lost", "skipped"}:
        raise ValueError(f"invalid outcome: {outcome}")
    try:
        b = backend()
        if b == "memory":
            hit = False
            for k, v in _mem_scored.items():
                if v["bid_no"] == bid_no:
                    v["status"] = outcome
                    hit = True
            return hit
        if b == "supabase":
            res = _client.table("bid_scored").update({"status": outcome}).eq("bid_no", bid_no).execute()
            return bool(res.data)
        docs = list(_client.collection("bid_scored").where("bid_no", "==", bid_no).stream())
        for d in docs:
            d.reference.update({"status": outcome})
        return bool(docs)
    except Exception as e:                                # noqa: BLE001
        log.exception("record_outcome failed: %s", e)
        return False


def list_scored(limit: int = 50, min_score: int = 0) -> list[dict]:
    try:
        b = backend()
        if b == "memory":
            rows = [r for r in _mem_scored.values() if r["score"] >= min_score]
        elif b == "supabase":
            rows = (_client.table("bid_scored").select("*")
                    .gte("score", min_score).order("scored_at", desc=True)
                    .limit(limit).execute().data or [])
        else:
            rows = [d.to_dict() for d in _client.collection("bid_scored")
                    .order_by("scored_at", direction="DESCENDING").limit(limit).stream()
                    if d.to_dict().get("score", 0) >= min_score]
        rows.sort(key=lambda r: (r.get("scored_at", ""), r.get("score", 0)), reverse=True)
        return rows[:limit]
    except Exception as e:                                # noqa: BLE001
        log.exception("list_scored failed: %s", e)
        return []


def reset_memory() -> None:
    """테스트 전용."""
    _mem_scored.clear()
    _mem_proposal.clear()
