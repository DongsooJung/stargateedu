#!/usr/bin/env python3
"""Refresh drive-blog/data.json from the public STARGATE Google Drive folder.

Authentication priority:
1. Application Default Credentials created by google-github-actions/auth (WIF)
2. GOOGLE_SERVICE_ACCOUNT_JSON legacy secret

The script only reads Drive metadata and writes a deterministic public index.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from google.oauth2 import service_account
import google.auth
from googleapiclient.discovery import build

FOLDER_ID = os.getenv("DRIVE_BLOG_FOLDER_ID", "18wK4G_-jzJHsLsvM3Ka5oWjrQChoK9Y4")
OUTPUT = Path(os.getenv("DRIVE_BLOG_OUTPUT", "drive-blog/data.json"))
SCOPES = ["https://www.googleapis.com/auth/drive.metadata.readonly"]

CURATED: dict[str, dict[str, Any]] = {
    "18VgljsswrJXGJ_gL63z1QvsIWIoZvdWQuFTncueB1-A": {
        "summary": "수학적 사고, 알고리즘, AI, 공간 데이터 분석을 교육과 실제 비즈니스 문제에 연결하는 STARGATE의 공개 지식 운영 원칙을 정리한 문서입니다.",
        "categories": ["ai", "education", "strategy"],
        "tags": ["AI", "교육", "데이터", "전략", "STARGATE"],
        "featured": True,
    },
    "1Zq9NLgzUqg_HF9iI05JBYaW1HDhgdi_P": {
        "title": "ChatGPT와 Ollama 이해하기",
        "summary": "ChatGPT와 로컬 LLM 도구 Ollama의 개념과 차이를 빠르게 파악하기 위한 입문 자료입니다. 클라우드형 AI와 로컬 실행형 AI의 활용 방향을 비교할 때 참고할 수 있습니다.",
        "categories": ["ai", "automation"],
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
    "strategy": ["전략", "사업", "시장", "수익", "기업", "비즈니스", "기획"],
    "automation": ["자동화", "api", "workflow", "워크플로", "agent", "mcp", "ollama"],
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


def credentials():
    raw = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if raw:
        info = json.loads(raw)
        return service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    creds, _ = google.auth.default(scopes=SCOPES)
    return creds


def normalize_title(name: str) -> str:
    title = re.sub(r"\.(pdf|docx?|pptx?|xlsx?)$", "", name, flags=re.I).strip()
    title = title.replace("_", " ")
    return re.sub(r"\s+", " ", title)


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
        ("강사", "강사"), ("스마트시티", "스마트시티"),
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
    summary = (item.get("description") or "").strip() or curated.get("summary") or GENERIC_SUMMARIES.get(categories[0], GENERIC_SUMMARIES["strategy"])
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


def main() -> None:
    service = build("drive", "v3", credentials=credentials(), cache_discovery=False)

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

    documents = [build_document(item) for item in files if item.get("mimeType") != "application/vnd.google-apps.folder"]
    documents.sort(key=lambda d: d.get("modifiedTime") or "", reverse=True)

    payload = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": {
            "type": "google-drive",
            "folderId": FOLDER_ID,
            "folderName": folder.get("name", "STARGATE 공개 지식 아카이브"),
            "folderUrl": folder.get("webViewLink") or f"https://drive.google.com/drive/folders/{FOLDER_ID}",
            "folderModifiedTime": folder.get("modifiedTime"),
        },
        "counts": {
            "documents": len(documents),
            "pdf": sum(1 for d in documents if d["kind"] == "PDF"),
            "googleDocs": sum(1 for d in documents if d["kind"] == "Google Docs"),
        },
        "documents": documents,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temp = OUTPUT.with_suffix(".json.tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(OUTPUT)
    print(f"Updated {OUTPUT} with {len(documents)} Drive documents from {folder.get('name', FOLDER_ID)}")


if __name__ == "__main__":
    main()
