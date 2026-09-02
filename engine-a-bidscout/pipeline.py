"""파이프라인 본체. FastAPI 와 CLI 가 공유합니다."""
from __future__ import annotations

import logging

import config as C
import sources
import store
import notify
from gemini_scorer import score_notices, draft_proposal

log = logging.getLogger("bidscout.pipeline")


def run(categories: list[str] | None = None, days_back: int = 1,
        dry_run: bool = False, max_drafts: int | None = None,
        notify_result: bool = True) -> dict:
    categories = categories or ["용역"]
    max_drafts = C.MAX_DRAFTS if max_drafts is None else max_drafts

    raw, errors = sources.collect(categories, days_back)

    seen_fn = None if dry_run else store.already_seen
    candidates, stats = sources.prefilter(raw, seen_fn)
    log.info("collected=%d prefiltered=%d", len(raw), len(candidates))

    if not candidates:
        result = {"collected": len(raw), "scored": 0, "go": 0, "drafts": 0,
                  "stats": stats, "errors": errors, "top": []}
        if notify_result and not dry_run:
            notify.send_digest([], [], stats, errors)
        return result

    scored = score_notices(candidates)
    scored.sort(key=lambda x: (x["score"], x["win_prob"]), reverse=True)

    if not dry_run:
        store.save_scored(scored)

    drafts = []
    for item in scored[:max_drafts]:
        if not item.get("go") or item["score"] < C.MIN_SCORE:
            break
        try:
            d = draft_proposal(item)
        except Exception as e:                            # noqa: BLE001
            log.exception("draft failed for %s: %s", item["bid_no"], e)
            errors.append(f"draft {item['bid_no']}: {e}")
            continue
        drafts.append(d)
        if not dry_run:
            store.save_proposal(item["bid_no"], d)
            store.record_outcome(item["bid_no"], "proposed")

    delivery = ""
    if notify_result:
        delivery = notify.send_digest(scored[:10], drafts, stats, errors)

    return {
        "collected": len(raw),
        "scored": len(scored),
        "go": sum(1 for s in scored if s.get("go")),
        "drafts": len(drafts),
        "stats": stats,
        "errors": errors,
        "delivery": delivery,
        "engine": sorted({s.get("engine", "?") for s in scored}),
        "top": [{"score": s["score"], "win_prob": s["win_prob"], "go": s.get("go"),
                 "title": s["title"], "budget": s.get("budget"), "reason": s.get("reason"),
                 "risk": s.get("risk"), "url": s.get("url")} for s in scored[:10]],
        "draft_previews": [{"bid_no": d["bid_no"], "title": d["title"],
                            "chars": len(d["markdown"])} for d in drafts],
    }
