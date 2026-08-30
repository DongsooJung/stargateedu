#!/usr/bin/env python3
"""Refresh and enrich drive-blog/data.json from the public STARGATE Google Drive folder.

P1: discover public Drive files and keep a deterministic JSON index.
P2: fetch public document text when possible, create a compact smart summary,
key points, audience and related STARGATE projects. If an OpenAI-compatible
endpoint is configured, AI enrichment is used; otherwise deterministic heuristics
keep the archive functional without secrets.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import google.auth
from google.auth.exceptions import DefaultCredentialsError
from google.oauth2 import service_account
from googleapiclient.discovery import build
import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader

FOLDER_ID = os.getenv("DRIVE_BLOG_FOLDER_ID", "18wK4G_-jzJHsLsvM3Ka5oWjrQChoK9Y4")
OUTPUT = Path(os.getenv("DRIVE_BLOG_OUTPUT", "drive-blog/data.json"))
SCOPES = ["https://www.googleapis.com/auth/drive.metadata.readonly"]
PUBLIC_FOLDER_URL = f"https://drive.google.com/drive/folders/{FOLDER_ID}"
SITE_BASE = "https://stargateedu.co.kr"
ENRICHMENT_VERSION = 1
MAX_TEXT_CHARS = int(os.getenv("DRIVE_BLOG_MAX_TEXT_CHARS", "16000"))

AI_API_BASE = os.getenv("AI_API_BASE", "").strip().rstrip("/")
AI_API_KEY = os.getenv("AI_API_KEY", "").strip()
AI_MODEL = os.getenv("AI_MODEL", "").strip()
AI_TIMEOUT = int(os.getenv("AI_TIMEOUT", "45"))

CURATED: dict[str, dict[str, Any]] = {
    "18VgljsswrJXGJ_gL63z1QvsIWIoZvdWQuFTncueB1-A": {
        "title": "STARGATE 공개 지식 아카이브 — AI·교육·데이터 전략",
        "summary": "수학적 사고, 알고리즘, AI, 공간 데이터 분석을 교육과 실제 비즈니스 문제에 연결하는 STARGATE의 공개 지식 운영 원칙을 정리한 문서입니다.",
        "categories": ["ai", "education", "strategy"],
        "tags": ["AI", "교육", "데이터", "전략", "STARGATE"],
        "featured": True,
    },
    "1Zq9NLgzUqg_HF9iI05JBYaW1HDhgdi_P": {
        "title": "ChatGPT와 Ollama 이해하기",
        "summary": "ChatGPT와 로컬 LLM 도구 Ollama의 개념과 차이를 빠르게 파악하기 위한 입문 자료입니다. 클라우드형 AI와 로컬 실행형 AI의 활용 방향을 비교할 때 참고할 수 있습니다.",
        "categories": ["ai", "automation", "publication"],
        "tags": ["ChatGPT", "Ollama", "LLM", "로컬AI"],
    },
    "1fI_OuNQigTekDDpEm-OXCUGQ3uu6AI7y": {
        "title": "2026 AI 강사 되는 법 가이드",
        "summary": "AI 강사 활동을 준비할 때 필요한 역량, 콘텐츠 구성, 교육시장 접근 방향을 정리한 전자책형 가이드입니다.",
        "categories": ["education", "ai", "publication"],
        "tags": ["AI강사", "AI교육", "전자책", "교육사업"],
    },
}

CATEGORY_RULES: dict[str, list[str]] = {
    "ai": ["ai", "chatgpt", "ollama", "llm", "gemini", "agent", "mcp", "인공지능"],
    "education": ["교육", "강사", "koi", "알고리즘", "algorithm", "수학", "학습", "강의"],
    "urban": ["도시", "gis", "공간", "스마트시티", "did", "헤도닉", "교통", "부동산"],
    "strategy": ["전략", "사업", "시장", "수익", "기업", "비즈니스", "기획", "정책"],
    "automation": ["자동화", "api", "workflow", "워크플로", "agent", "mcp", "ollama", "cloud"],
    "publication": ["전자책", "보고서", "가이드", "report", "guide", "백서", "pdf"],
}

CATEGORY_LABELS = {
    "ai": "AI",
    "education": "교육",
    "urban": "도시·GIS",
    "strategy": "전략",
    "automation": "자동화",
    "publication": "출판·보고서",
}

GENERIC_SUMMARIES = {
    "ai": "STARGATE 공개 Drive에 등록된 AI 관련 자료입니다. 세부 내용과 원문은 Drive에서 확인할 수 있습니다.",
    "education": "STARGATE 공개 Drive에 등록된 교육·학습 관련 자료입니다. 세부 내용과 원문은 Drive에서 확인할 수 있습니다.",
    "urban": "STARGATE 공개 Drive에 등록된 도시·공간데이터 관련 자료입니다. 세부 내용과 원문은 Drive에서 확인할 수 있습니다.",
    "strategy": "STARGATE 공개 Drive에 등록된 사업·전략 관련 자료입니다. 세부 내용과 원문은 Drive에서 확인할 수 있습니다.",
    "automation": "STARGATE 공개 Drive에 등록된 자동화·API 관련 자료입니다. 세부 내용과 원문은 Drive에서 확인할 수 있습니다.",
    "publication": "STARGATE 공개 Drive에 등록된 보고서·출판 자료입니다. 세부 내용과 원문은 Drive에서 확인할 수 있습니다.",
}

PROJECTS: list[dict[str, Any]] = [
    {
        "id": "debate-analyzer",
        "title": "AI 정치토론 분석기",
        "url": f"{SITE_BASE}/research/debate-analyzer/",
        "categories": ["ai", "strategy"],
        "keywords": ["토론", "정치", "분석", "llm", "ai", "평가"],
        "description": "토론 내용을 AI 기준으로 요약·평가하는 연구 프로젝트",
    },
    {
        "id": "google-cloud",
        "title": "Google Cloud API 연구",
        "url": f"{SITE_BASE}/research/google-cloud/",
        "categories": ["ai", "automation"],
        "keywords": ["google", "cloud", "api", "gemini", "자동화", "서버"],
        "description": "Google Cloud API와 서비스 연동을 정리한 연구 대시보드",
    },
    {
        "id": "koi-coach",
        "title": "KOI Coach",
        "url": f"{SITE_BASE}/koi-coach/",
        "categories": ["education", "ai"],
        "keywords": ["koi", "알고리즘", "수학", "교육", "강의", "학습"],
        "description": "알고리즘·KOI 교육 및 코칭 프로젝트",
    },
    {
        "id": "seoul-realtors",
        "title": "서울 공인중개사 GIS",
        "url": f"{SITE_BASE}/research/seoul-realtors/",
        "categories": ["urban", "strategy"],
        "keywords": ["gis", "공간", "부동산", "서울", "중개사", "지도"],
        "description": "서울 공인중개사 위치를 공간 데이터로 분석하는 GIS 프로젝트",
    },
    {
        "id": "immigration-policy",
        "title": "이민정책 대시보드",
        "url": f"{SITE_BASE}/research/immigration-policy/",
        "categories": ["strategy", "urban"],
        "keywords": ["정책", "비자", "외국인", "이민", "행정", "인구"],
        "description": "외국인·비자·이민정책 데이터를 분석하는 연구 프로젝트",
    },
    {
        "id": "pmo",
        "title": "PMO 운영 대시보드",
        "url": f"{SITE_BASE}/pmo/",
        "categories": ["strategy", "automation"],
        "keywords": ["pmo", "프로젝트", "운영", "관리", "자동화", "실행"],
        "description": "프로젝트 실행·관리와 운영 체계를 정리한 PMO 허브",
    },
    {
        "id": "trade",
        "title": "무역 데이터 대시보드",
        "url": f"{SITE_BASE}/trade/",
        "categories": ["strategy"],
        "keywords": ["무역", "수출", "수입", "경제", "시장", "데이터"],
        "description": "수출입 및 무역 데이터를 분석하는 공개 대시보드",
    },
    {
        "id": "strategy",
        "title": "STARGATE 전략 대시보드",
        "url": f"{SITE_BASE}/strategy/",
        "categories": ["strategy", "automation"],
        "keywords": ["전략", "사업", "시장", "수익", "기업", "기획"],
        "description": "사업·수익화·운영 과제를 관리하는 전략 허브",
    },
]


def optional_credentials():
    raw = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if raw:
        try:
            info = json.loads(raw)
            return service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
        except Exception as exc:
            print(f"Drive credential secret is unusable; using public-folder fallback: {type(exc).__name__}")
            return None
    try:
        creds, _ = google.auth.default(scopes=SCOPES)
        return creds
    except DefaultCredentialsError:
        return None


def normalize_title(name: str) -> str:
    title = re.sub(r"\.(pdf|docx?|pptx?|xlsx?)$", "", name, flags=re.I).strip()
    title = title.replace("_", " ")
    return re.sub(r"\s+", " ", title)


def clean_text(value: str) -> str:
    value = value.replace("\x00", " ")
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def infer_categories(name: str, mime_type: str) -> list[str]:
    hay = f"{name} {mime_type}".lower()
    found = [category for category, words in CATEGORY_RULES.items() if any(word.lower() in hay for word in words)]
    if mime_type == "application/pdf" and "publication" not in found:
        found.append("publication")
    return found or ["strategy"]


def infer_tags(title: str, categories: list[str]) -> list[str]:
    tags: list[str] = []
    hay = title.lower()
    for category in categories:
        label = CATEGORY_LABELS.get(category)
        if label and label not in tags:
            tags.append(label)
    keyword_tags = [
        ("chatgpt", "ChatGPT"), ("ollama", "Ollama"), ("gemini", "Gemini"),
        ("llm", "LLM"), ("mcp", "MCP"), ("api", "API"), ("koi", "KOI"),
        ("gis", "GIS"), ("python", "Python"), ("알고리즘", "알고리즘"),
        ("강사", "강사"), ("스마트시티", "스마트시티"), ("정책", "정책"),
    ]
    for needle, label in keyword_tags:
        if needle in hay and label not in tags:
            tags.append(label)
    return tags[:6]


def kind_for(mime_type: str) -> str:
    mapping = {
        "application/pdf": "PDF",
        "application/vnd.google-apps.document": "Google Docs",
        "application/vnd.google-apps.spreadsheet": "Google Sheets",
        "application/vnd.google-apps.presentation": "Google Slides",
        "application/vnd.google-apps.folder": "Folder",
    }
    return mapping.get(mime_type, "Drive File")


def fallback_url(file_id: str, mime_type: str) -> str:
    if mime_type == "application/vnd.google-apps.document":
        return f"https://docs.google.com/document/d/{file_id}/edit"
    if mime_type == "application/vnd.google-apps.spreadsheet":
        return f"https://docs.google.com/spreadsheets/d/{file_id}/edit"
    if mime_type == "application/vnd.google-apps.presentation":
        return f"https://docs.google.com/presentation/d/{file_id}/edit"
    return f"https://drive.google.com/file/d/{file_id}/view"


def build_document(item: dict[str, Any]) -> dict[str, Any]:
    file_id = item["id"]
    curated = CURATED.get(file_id, {})
    raw_title = item.get("name") or "Untitled"
    title = curated.get("title") or normalize_title(raw_title)
    mime_type = item.get("mimeType", "")
    categories = curated.get("categories") or infer_categories(raw_title, mime_type)
    tags = curated.get("tags") or infer_tags(title, categories)
    summary = (
        (item.get("description") or "").strip()
        or curated.get("summary")
        or GENERIC_SUMMARIES.get(categories[0], GENERIC_SUMMARIES["strategy"])
    )
    return {
        "id": file_id,
        "title": title,
        "sourceTitle": raw_title,
        "summary": summary,
        "url": item.get("webViewLink") or fallback_url(file_id, mime_type),
        "mimeType": mime_type,
        "kind": kind_for(mime_type),
        "categories": categories,
        "tags": tags,
        "featured": bool(curated.get("featured", False)),
        "createdTime": item.get("createdTime"),
        "modifiedTime": item.get("modifiedTime"),
        "size": int(item["size"]) if str(item.get("size", "")).isdigit() else None,
    }


def list_with_drive_api(creds) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    service = build("drive", "v3", credentials=creds, cache_discovery=False)
    folder = service.files().get(
        fileId=FOLDER_ID,
        fields="id,name,webViewLink,modifiedTime",
        supportsAllDrives=True,
    ).execute()

    files: list[dict[str, Any]] = []
    page_token = None
    while True:
        response = service.files().list(
            q=f"'{FOLDER_ID}' in parents and trashed = false",
            spaces="drive",
            fields="nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,webViewLink,description,size)",
            orderBy="modifiedTime desc",
            pageSize=100,
            pageToken=page_token,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        ).execute()
        files.extend(response.get("files", []))
        page_token = response.get("nextPageToken")
        if not page_token:
            break
    folder["syncMethod"] = "drive-api"
    return folder, files


def decode_drive_bootstrap(encoded: str) -> str:
    """Decode Drive JavaScript hex escapes while preserving existing UTF-8."""
    return re.sub(r"\\x([0-9A-Fa-f]{2})", lambda m: chr(int(m.group(1), 16)), encoded)


def list_from_public_folder() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Parse Google's public folder bootstrap data; no API key or OAuth required."""
    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.8",
    }
    response = requests.get(f"{PUBLIC_FOLDER_URL}?hl=en", headers=headers, timeout=30)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")

    encoded = None
    pattern = re.compile(r"window\['_DRIVE_ivd'\]\s*=\s*'(.*?)';", re.S)
    for tag in soup.find_all("script"):
        text = tag.string or tag.get_text() or ""
        if "_DRIVE_ivd" not in text:
            continue
        match = pattern.search(text)
        if match:
            encoded = match.group(1)
            break
    if not encoded:
        raise RuntimeError("Public Drive bootstrap data (_DRIVE_ivd) not found")

    decoded = decode_drive_bootstrap(encoded)
    folder_arr = json.loads(decoded)
    entries = [] if not folder_arr or folder_arr[0] is None else folder_arr[0]

    files: list[dict[str, Any]] = []
    for entry in entries:
        if not isinstance(entry, list) or len(entry) < 4:
            continue
        file_id, name, mime_type = entry[0], entry[2], entry[3]
        if not file_id or not name or not mime_type:
            continue
        item: dict[str, Any] = {
            "id": file_id,
            "name": name,
            "mimeType": mime_type,
            "webViewLink": fallback_url(file_id, mime_type),
            "modifiedTime": None,
            "createdTime": None,
        }
        if len(entry) > 13 and isinstance(entry[13], (int, float)) and entry[13] >= 0:
            item["size"] = int(entry[13])
        files.append(item)

    if not files:
        raise RuntimeError("Public Drive folder returned no parsable files")

    title = soup.title.get_text(strip=True) if soup.title else "스타게이트_공개블로그"
    folder_name = title.rsplit(" - ", 1)[0].strip() if " - " in title else title
    folder = {
        "id": FOLDER_ID,
        "name": folder_name or "스타게이트_공개블로그",
        "webViewLink": PUBLIC_FOLDER_URL,
        "modifiedTime": None,
        "syncMethod": "public-folder-html",
    }
    return folder, files


def fetch_public_text(item: dict[str, Any]) -> tuple[str, str]:
    """Return normalized public text and a content hash. Failure is non-fatal."""
    file_id = item["id"]
    mime_type = item.get("mimeType", "")
    text = ""
    headers = {"User-Agent": "Mozilla/5.0 STARGATE-Knowledge-Archive/2.0"}

    try:
        if mime_type == "application/vnd.google-apps.document":
            url = f"https://docs.google.com/document/d/{file_id}/export?format=txt"
            response = requests.get(url, headers=headers, timeout=30)
            response.raise_for_status()
            text = response.content.decode("utf-8", errors="replace")
        elif mime_type == "application/pdf":
            urls = [
                f"https://drive.google.com/uc?export=download&id={file_id}",
                f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t",
            ]
            pdf_bytes = None
            for url in urls:
                response = requests.get(url, headers=headers, timeout=45, allow_redirects=True)
                if response.ok and (
                    "application/pdf" in response.headers.get("content-type", "").lower()
                    or response.content.startswith(b"%PDF")
                ):
                    pdf_bytes = response.content
                    break
            if pdf_bytes:
                reader = PdfReader(io.BytesIO(pdf_bytes))
                parts = []
                for page in reader.pages[:20]:
                    parts.append(page.extract_text() or "")
                    if sum(len(part) for part in parts) >= MAX_TEXT_CHARS:
                        break
                text = "\n".join(parts)
    except Exception as exc:
        print(f"Text extraction skipped for {file_id}: {type(exc).__name__}")

    text = clean_text(text)[:MAX_TEXT_CHARS]
    fingerprint_source = text or f"{item.get('name','')}|{item.get('size','')}|{mime_type}"
    content_hash = hashlib.sha256(fingerprint_source.encode("utf-8", errors="ignore")).hexdigest()
    return text, content_hash


def heuristic_key_points(text: str, title: str, summary: str, categories: list[str]) -> list[str]:
    source = clean_text(text) if text else clean_text(f"{summary} {title}")
    chunks = re.split(r"(?<=[.!?。])\s+|(?<=다\.)\s+", source)
    points: list[str] = []
    for chunk in chunks:
        chunk = clean_text(chunk)
        if len(chunk) < 18:
            continue
        if len(chunk) > 180:
            chunk = chunk[:177].rstrip() + "…"
        if chunk not in points:
            points.append(chunk)
        if len(points) == 3:
            break
    while len(points) < 3:
        label = CATEGORY_LABELS.get(categories[len(points) % len(categories)] if categories else "strategy", "자료")
        fallback = f"{title}의 {label} 관점에서 핵심 내용을 원문과 함께 확인할 수 있습니다."
        if fallback not in points:
            points.append(fallback)
    return points[:3]


def heuristic_summary(text: str, title: str, fallback: str) -> str:
    if not text:
        return fallback
    points = heuristic_key_points(text, title, fallback, ["strategy"])
    summary = " ".join(points[:2])
    if len(summary) > 320:
        summary = summary[:317].rstrip() + "…"
    return summary


def infer_audience(categories: list[str]) -> str:
    labels = {
        "ai": "AI 도구를 업무·교육에 적용하려는 실무자",
        "education": "수학·알고리즘·AI 교육자와 학습자",
        "urban": "도시·GIS·공간데이터 연구자와 실무자",
        "strategy": "사업기획·정책·전략 의사결정자",
        "automation": "API·자동화·AI 운영 담당자",
        "publication": "주제 입문자와 실무 참고자료가 필요한 독자",
    }
    audience = [labels[c] for c in categories if c in labels]
    return " · ".join(audience[:2]) if audience else "STARGATE 공개 연구자료를 활용하려는 실무자"


def recommend_projects(doc: dict[str, Any], text: str) -> list[dict[str, str]]:
    hay = clean_text(" ".join([
        doc.get("title", ""),
        doc.get("summary", ""),
        " ".join(doc.get("tags", [])),
        text[:5000],
    ])).lower()
    categories = set(doc.get("categories", []))
    ranked: list[tuple[int, dict[str, Any], list[str]]] = []
    for project in PROJECTS:
        overlap = categories.intersection(project["categories"])
        keyword_hits = [kw for kw in project["keywords"] if kw.lower() in hay]
        score = len(overlap) * 4 + min(len(keyword_hits), 4)
        if score <= 0:
            continue
        ranked.append((score, project, keyword_hits))
    ranked.sort(key=lambda row: (-row[0], row[1]["title"]))

    results = []
    for _, project, hits in ranked[:3]:
        reason_bits = []
        common = categories.intersection(project["categories"])
        if common:
            reason_bits.append("·".join(CATEGORY_LABELS.get(c, c) for c in sorted(common)))
        if hits:
            reason_bits.append(", ".join(hits[:2]))
        reason = f"{' / '.join(reason_bits)} 주제가 연결됩니다." if reason_bits else project["description"]
        results.append({
            "id": project["id"],
            "title": project["title"],
            "url": project["url"],
            "reason": reason,
        })
    if not results:
        project = PROJECTS[-1]
        results.append({
            "id": project["id"],
            "title": project["title"],
            "url": project["url"],
            "reason": "사업·연구 활용 관점에서 전략 대시보드와 함께 검토할 수 있습니다.",
        })
    return results


def ai_endpoint() -> str | None:
    if not (AI_API_BASE and AI_API_KEY and AI_MODEL):
        return None
    if AI_API_BASE.endswith("/chat/completions"):
        return AI_API_BASE
    return f"{AI_API_BASE}/chat/completions"


def parse_json_object(value: str) -> dict[str, Any]:
    value = value.strip()
    value = re.sub(r"^```(?:json)?\s*", "", value, flags=re.I)
    value = re.sub(r"\s*```$", "", value)
    start, end = value.find("{"), value.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("AI response did not contain a JSON object")
    return json.loads(value[start:end + 1])


def ai_enrich(doc: dict[str, Any], text: str) -> dict[str, Any] | None:
    endpoint = ai_endpoint()
    if not endpoint or not text:
        return None

    allowed_categories = list(CATEGORY_LABELS)
    prompt = {
        "title": doc["title"],
        "existing_summary": doc["summary"],
        "existing_categories": doc["categories"],
        "existing_tags": doc["tags"],
        "document_text": text[:10000],
    }
    instructions = (
        "한국어 공개 지식 아카이브 메타데이터를 만든다. 과장하거나 문서에 없는 사실을 만들지 말 것. "
        "반드시 JSON 객체만 반환한다. 필드: smartSummary(2~3문장, 320자 이내), "
        "keyPoints(정확히 3개 문자열), audience(한 문장), tags(최대 6개 문자열), "
        f"categories(다음 값만 사용: {allowed_categories})."
    )
    payload = {
        "model": AI_MODEL,
        "temperature": 0.15,
        "messages": [
            {"role": "system", "content": instructions},
            {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
        ],
    }
    try:
        response = requests.post(
            endpoint,
            headers={
                "Authorization": f"Bearer {AI_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=AI_TIMEOUT,
        )
        response.raise_for_status()
        body = response.json()
        content = body["choices"][0]["message"]["content"]
        parsed = parse_json_object(content)
        smart_summary = clean_text(str(parsed.get("smartSummary", "")))[:340]
        key_points = [clean_text(str(v))[:190] for v in parsed.get("keyPoints", []) if clean_text(str(v))][:3]
        audience = clean_text(str(parsed.get("audience", "")))[:220]
        tags = [clean_text(str(v))[:40] for v in parsed.get("tags", []) if clean_text(str(v))][:6]
        categories = [v for v in parsed.get("categories", []) if v in CATEGORY_LABELS][:4]
        if not smart_summary or len(key_points) < 3:
            raise ValueError("AI enrichment missing required fields")
        return {
            "smartSummary": smart_summary,
            "keyPoints": key_points,
            "audience": audience or infer_audience(doc["categories"]),
            "tags": tags or doc["tags"],
            "categories": categories or doc["categories"],
            "enrichmentMode": "ai",
        }
    except Exception as exc:
        print(f"AI enrichment failed for {doc['id']}; using heuristic: {type(exc).__name__}")
        return None


def enrich_document(doc: dict[str, Any], item: dict[str, Any], previous: dict[str, Any] | None) -> dict[str, Any]:
    text, content_hash = fetch_public_text(item)
    reusable_fields = [
        "smartSummary", "keyPoints", "audience", "relatedProjects",
        "enrichmentMode", "contentHash", "enrichmentVersion",
    ]
    if (
        previous
        and previous.get("contentHash") == content_hash
        and previous.get("enrichmentVersion") == ENRICHMENT_VERSION
        and all(field in previous for field in reusable_fields)
    ):
        for field in reusable_fields:
            doc[field] = previous[field]
        if previous.get("enrichmentMode") == "ai":
            doc["tags"] = previous.get("tags", doc["tags"])
            doc["categories"] = previous.get("categories", doc["categories"])
        return doc

    ai_result = ai_enrich(doc, text)
    if ai_result:
        doc["smartSummary"] = ai_result["smartSummary"]
        doc["keyPoints"] = ai_result["keyPoints"]
        doc["audience"] = ai_result["audience"]
        doc["tags"] = ai_result["tags"]
        doc["categories"] = ai_result["categories"]
        doc["enrichmentMode"] = "ai"
    else:
        doc["smartSummary"] = heuristic_summary(text, doc["title"], doc["summary"])
        doc["keyPoints"] = heuristic_key_points(text, doc["title"], doc["summary"], doc["categories"])
        doc["audience"] = infer_audience(doc["categories"])
        doc["enrichmentMode"] = "heuristic"

    doc["relatedProjects"] = recommend_projects(doc, text)
    doc["contentHash"] = content_hash
    doc["enrichmentVersion"] = ENRICHMENT_VERSION
    return doc


def same_content(previous: dict[str, Any], current: dict[str, Any]) -> bool:
    """Ignore generation timestamps so an unchanged Drive does not create a commit."""
    def stable(payload: dict[str, Any]) -> dict[str, Any]:
        clone = json.loads(json.dumps(payload, ensure_ascii=False))
        clone.pop("generatedAt", None)
        return clone
    return stable(previous) == stable(current)


def main() -> None:
    previous_payload: dict[str, Any] = {}
    if OUTPUT.exists():
        try:
            previous_payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            previous_payload = {}
    previous_docs = {d.get("id"): d for d in previous_payload.get("documents", []) if d.get("id")}

    creds = optional_credentials()
    if creds is not None:
        try:
            folder, files = list_with_drive_api(creds)
            print("Drive sync source: authenticated Drive API")
        except Exception as exc:
            print(f"Drive API failed; falling back to public folder HTML: {type(exc).__name__}: {exc}")
            folder, files = list_from_public_folder()
    else:
        print("Drive credentials unavailable; using public folder HTML fallback")
        folder, files = list_from_public_folder()

    documents = []
    for item in files:
        if item.get("mimeType") == "application/vnd.google-apps.folder":
            continue
        doc = build_document(item)
        doc = enrich_document(doc, item, previous_docs.get(doc["id"]))
        documents.append(doc)

    documents.sort(key=lambda d: ((d.get("modifiedTime") or ""), (d.get("title") or "")), reverse=True)

    ai_count = sum(1 for d in documents if d.get("enrichmentMode") == "ai")
    heuristic_count = sum(1 for d in documents if d.get("enrichmentMode") == "heuristic")
    payload = {
        "version": 3,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": {
            "type": "google-drive",
            "syncMethod": folder.get("syncMethod", "unknown"),
            "folderId": FOLDER_ID,
            "folderName": folder.get("name", "스타게이트_공개블로그"),
            "folderUrl": folder.get("webViewLink") or PUBLIC_FOLDER_URL,
            "folderModifiedTime": folder.get("modifiedTime"),
        },
        "enrichment": {
            "version": ENRICHMENT_VERSION,
            "aiConfigured": bool(ai_endpoint()),
            "aiDocuments": ai_count,
            "heuristicDocuments": heuristic_count,
            "model": AI_MODEL if ai_endpoint() else None,
        },
        "counts": {
            "documents": len(documents),
            "pdf": sum(1 for d in documents if d["kind"] == "PDF"),
            "googleDocs": sum(1 for d in documents if d["kind"] == "Google Docs"),
        },
        "documents": documents,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    if previous_payload and same_content(previous_payload, payload):
        print(f"No Drive or enrichment changes; keeping {OUTPUT} unchanged")
        return

    temp = OUTPUT.with_suffix(".json.tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(OUTPUT)
    print(
        f"Updated {OUTPUT}: {len(documents)} docs, AI={ai_count}, "
        f"heuristic={heuristic_count}, source={folder.get('syncMethod', 'unknown')}"
    )


if __name__ == "__main__":
    main()
