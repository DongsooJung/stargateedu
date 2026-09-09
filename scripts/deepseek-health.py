#!/usr/bin/env python3
"""Safe DeepSeek API health check for GitHub Actions.

Never prints or writes the API key. The artifact contains only sanitized status
information needed to diagnose authentication, balance, model and API errors.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import requests

OUT = Path("/tmp/deepseek-health.json")
BASE = os.getenv("AI_API_BASE", "https://api.deepseek.com").strip().rstrip("/")
KEY = os.getenv("AI_API_KEY", "").strip()
MODEL = os.getenv("AI_MODEL", "deepseek-v4-flash").strip()


def safe_error(resp: requests.Response) -> dict:
    result = {"httpStatus": resp.status_code}
    try:
        body = resp.json()
        err = body.get("error", {}) if isinstance(body, dict) else {}
        if isinstance(err, dict):
            for field in ("message", "type", "code"):
                value = err.get(field)
                if value is not None:
                    result[field] = str(value)[:500]
    except Exception:
        result["message"] = "Non-JSON API error response"
    return result


def write(data: dict) -> None:
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("DeepSeek health:", data.get("status", "unknown"), "| model:", MODEL)


def main() -> None:
    result = {"provider": "deepseek", "base": BASE, "model": MODEL, "status": "unknown"}
    if not KEY:
        result["status"] = "credential_missing"
        write(result)
        return

    headers = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

    try:
        balance = requests.get(f"{BASE}/user/balance", headers=headers, timeout=20)
    except Exception as exc:
        result.update({"status": "network_error", "stage": "balance", "errorType": type(exc).__name__})
        write(result)
        return

    if balance.status_code != 200:
        result.update({"status": "api_error", "stage": "balance", **safe_error(balance)})
        write(result)
        return

    try:
        balance_body = balance.json()
        result["balanceAvailable"] = bool(balance_body.get("is_available"))
    except Exception:
        result.update({"status": "invalid_response", "stage": "balance"})
        write(result)
        return

    if not result["balanceAvailable"]:
        result.update({"status": "insufficient_balance", "stage": "balance", "httpStatus": 402})
        write(result)
        return

    payload = {
        "model": MODEL,
        "thinking": {"type": "disabled"},
        "messages": [
            {"role": "system", "content": "Return valid JSON only."},
            {"role": "user", "content": "Return this JSON object exactly: {\"ok\": true}"},
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 64,
        "temperature": 0,
        "stream": False,
    }
    try:
        smoke = requests.post(f"{BASE}/chat/completions", headers=headers, json=payload, timeout=30)
    except Exception as exc:
        result.update({"status": "network_error", "stage": "chat", "errorType": type(exc).__name__})
        write(result)
        return

    if smoke.status_code != 200:
        result.update({"status": "api_error", "stage": "chat", **safe_error(smoke)})
        write(result)
        return

    try:
        content = smoke.json()["choices"][0]["message"]["content"]
        parsed = json.loads(content)
        if parsed.get("ok") is not True:
            raise ValueError("Unexpected smoke response")
    except Exception as exc:
        result.update({"status": "invalid_response", "stage": "chat", "errorType": type(exc).__name__})
        write(result)
        return

    result.update({"status": "ok", "stage": "complete", "httpStatus": 200})
    write(result)


if __name__ == "__main__":
    main()
