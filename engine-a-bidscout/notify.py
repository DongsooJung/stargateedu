"""
결과 알림. SMTP 미설정이거나 OFFLINE 이면 콘솔로 출력합니다 (조용히 사라지지 않게).
"""
from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage
from datetime import datetime

import config as C

log = logging.getLogger("bidscout.notify")


def _fmt_budget(v) -> str:
    v = v or 0
    if not v:
        return "미상"
    if v >= 100_000_000:
        return f"{v/100_000_000:.1f}억"
    return f"{v/10_000:,.0f}만"


def _table(items: list[dict]) -> str:
    lines = ["| 점수 | 낙찰 | 공고명 | 발주기관 | 추정가 | 마감 |",
             "|---:|---:|---|---|---:|---|"]
    for i in items:
        title = i.get("title", "")[:38]
        url = i.get("url") or ""
        cell = f"[{title}]({url})" if url else title
        lines.append(
            f"| {i['score']} | {i['win_prob']}% | {cell} | "
            f"{(i.get('agency') or '미상')[:12]} | {_fmt_budget(i.get('budget'))} | "
            f"{(i.get('deadline') or '')[:8]} |"
        )
    return "\n".join(lines)


def build_report(top: list[dict], drafts: list[dict], stats: dict,
                 errors: list[str] | None = None) -> tuple[str, str]:
    today = datetime.now(C.KST).strftime("%Y-%m-%d")
    go = sum(1 for t in top if t.get("go"))
    engines = {t.get("engine", "?") for t in top}
    stub = any("stub" in e for e in engines)

    subject = f"[BidScout] {today} 제안 권고 {go}건 / 초안 {len(drafts)}건"
    if stub:
        subject = "[스텁] " + subject

    body = [f"# BidScout 일일 리포트 — {today}", ""]
    if stub:
        body += ["> **주의: OFFLINE 스텁 판정입니다. 실제 Gemini 판정이 아닙니다.**", ""]

    body += [
        f"수집 {stats.get('total', 0)}건 → 사전필터 통과 {stats.get('kept', 0)}건 "
        f"→ 판정 {len(top)}건 → 제안 권고 **{go}건** → 초안 {len(drafts)}건",
        "",
        f"필터 내역: 중복 {stats.get('seen',0)} · 제외키워드 {stats.get('negative_kw',0)} · "
        f"무관 {stats.get('no_positive_kw',0)} · 소액 {stats.get('budget_low',0)} · "
        f"과대 {stats.get('budget_high',0)}",
        "",
        f"판정 엔진: {', '.join(sorted(engines)) or '없음'}",
        "",
        "## 상위 공고",
        _table(top),
        "",
        "## 판정 근거",
    ]
    for t in top[:5]:
        mark = "**[권고]** " if t.get("go") else ""
        body.append(f"- {mark}{t.get('title','')[:44]} — {t.get('reason','')} / 리스크: {t.get('risk','')}")

    if drafts:
        body += ["", "## 첨부된 제안서 초안"]
        for d in drafts:
            body.append(f"- {d['title'][:48]} (마감 {(d.get('deadline') or '')[:8]})")

    if errors:
        body += ["", "## 수집 오류"] + [f"- {e}" for e in errors]

    return subject, "\n".join(body)


def send_digest(top: list[dict], drafts: list[dict], stats: dict,
                errors: list[str] | None = None) -> str:
    subject, text = build_report(top, drafts, stats, errors)

    if C.OFFLINE or not (C.SMTP_USER and C.SMTP_PASS):
        why = "OFFLINE" if C.OFFLINE else "SMTP 미설정"
        print(f"\n{'='*70}\n[{why}] 메일 대신 콘솔 출력\n{'='*70}\n{subject}\n\n{text}\n")
        for d in drafts:
            print(f"\n--- 제안서 초안: {d['bid_no']} ---\n{d['markdown'][:1500]}\n")
        return f"console:{why}"

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = C.SMTP_USER
    msg["To"] = C.MAIL_TO
    msg.set_content(text)

    for d in drafts:
        safe = "".join(c for c in d["title"][:30] if c.isalnum() or c in " -_")
        msg.add_attachment(d["markdown"].encode("utf-8"), maintype="text",
                           subtype="markdown", filename=f"{d['bid_no']}_{safe}.md")
    try:
        with smtplib.SMTP(C.SMTP_HOST, C.SMTP_PORT, timeout=30) as s:
            s.starttls()
            s.login(C.SMTP_USER, C.SMTP_PASS)
            s.send_message(msg)
        log.info("digest sent to %s", C.MAIL_TO)
        return f"smtp:{C.MAIL_TO}"
    except Exception as e:                                # noqa: BLE001
        log.exception("send_digest failed: %s", e)
        print(f"\n[SMTP 실패 — 콘솔 대체]\n{subject}\n\n{text}\n")
        return f"failed:{e}"
