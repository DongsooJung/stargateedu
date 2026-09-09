#!/usr/bin/env python3
"""Run Drive archive sync with a DeepSeek V4-specific enrichment adapter.

The core Drive indexing remains in update-drive-blog.py. This wrapper replaces
only the optional AI enrichment function so the production workflow can use
current DeepSeek V4 parameters, strict JSON output and sanitized diagnostics.
"""
from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path
from typing import Any

import requests

CORE = Path(__file__).with_name("update-drive-blog.py")
DIAG = Path("/tmp/deepseek-enrichment.json")

spec = importlib.util.spec_from_file_location("drive_blog_sync", CORE)
if spec is None or spec.loader is None:
    raise RuntimeError("Could not load Drive archive core module")
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)

diagnostics: dict[str, Any] = {
    "provider": "deepseek",
    "model": core.AI_MODEL,
    "attempted": 0,
    "succeeded": 0,
    "failures": [],
}


def _safe_error(resp: requests.Response) -> dict[str, Any]:
    result: dict[str, Any] = {"httpStatus": resp.status_code}
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


def _list_strings(value: Any, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        text = str(item).strip()
        if text and text not in out:
            out.append(text)
    return out[:limit]


def _parse_json_content(content: str) -> dict[str, Any]:
    content = (content or "").strip()
    try:
        parsed = json.loads(content)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    match = re.search(r"\{.*\}", content, flags=re.S)
    if not match:
        raise ValueError("No JSON object in model response")
    parsed = json.loads(match.group(0))
    if not isinstance(parsed, dict):
        raise ValueError("Model response JSON is not an object")
    return parsed


def ai_enrich(doc: dict[str, Any], text: str) -> dict[str, Any] | None:
    endpoint = core.ai_endpoint()
    if not endpoint or not text.strip():
        return None

    diagnostics["attempted"] += 1
    allowed_categories = list(core.CATEGORY_RULES.keys())
    prompt = f"""문서 제목: {doc['title']}
현재 분류: {', '.join(doc['categories'])}
현재 태그: {', '.join(doc['tags'])}

아래 공개 문서를 분석해 STARGATE 지식 아카이브용 메타데이터를 만드세요.
반드시 JSON 객체만 출력하세요.

JSON 형식:
{{
  "summary": "한국어 2~3문장 요약",
  "keyPoints": ["핵심1", "핵심2", "핵심3"],
  "audience": "추천 독자",
  "tags": ["태그1", "태그2"],
  "categories": ["ai"]
}}

categories는 다음 값만 사용: {', '.join(allowed_categories)}
keyPoints는 정확히 3개, tags는 최대 6개로 작성하세요.

문서 본문:
{text[:core.MAX_TEXT_CHARS]}
"""
    payload = {
        "model": core.AI_MODEL,
        "thinking": {"type": "disabled"},
        "messages": [
            {
                "role": "system",
                "content": "You create concise Korean metadata for a public knowledge archive. Return valid JSON only.",
            },
            {"role": "user", "content": prompt},
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 1200,
        "temperature": 0.15,
        "stream": False,
    }
    headers = {
        "Authorization": f"Bearer {core.AI_API_KEY}",
        "Content-Type": "application/json",
    }

    last_error: dict[str, Any] | None = None
    for attempt in range(1, 3):
        try:
            resp = requests.post(endpoint, headers=headers, json=payload, timeout=core.AI_TIMEOUT)
            if resp.status_code != 200:
                last_error = {"documentId": doc["id"], "attempt": attempt, **_safe_error(resp)}
                if resp.status_code in {401, 402, 400, 422}:
                    break
                continue

            body = resp.json()
            content = body["choices"][0]["message"]["content"]
            parsed = _parse_json_content(content)

            smart_summary = str(parsed.get("summary") or "").strip()
            key_points = _list_strings(parsed.get("keyPoints"), 3)
            audience = str(parsed.get("audience") or "").strip()
            tags = _list_strings(parsed.get("tags"), 6)
            categories = [
                c for c in _list_strings(parsed.get("categories"), 6)
                if c in core.CATEGORY_RULES
            ]
            if not smart_summary or len(key_points) != 3:
                raise ValueError("AI metadata missing required summary/keyPoints")

            diagnostics["succeeded"] += 1
            return {
                "smartSummary": smart_summary,
                "keyPoints": key_points,
                "audience": audience or core.infer_audience(doc["categories"]),
                "tags": tags or doc["tags"],
                "categories": categories or doc["categories"],
                "enrichmentMode": "ai",
            }
        except Exception as exc:
            last_error = {
                "documentId": doc["id"],
                "attempt": attempt,
                "errorType": type(exc).__name__,
                "message": str(exc)[:500],
            }

    if last_error:
        diagnostics["failures"].append(last_error)
        print(
            "DeepSeek enrichment failed for",
            doc["id"],
            "|",
            last_error.get("httpStatus", last_error.get("errorType", "unknown")),
        )
    return None


core.ai_enrich = ai_enrich

try:
    core.main()
finally:
    diagnostics["failed"] = len(diagnostics["failures"])
    DIAG.write_text(json.dumps(diagnostics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"DeepSeek enrichment diagnostics: {diagnostics['succeeded']}/{diagnostics['attempted']} succeeded"
    )
