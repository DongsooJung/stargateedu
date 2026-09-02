"""
Gemini multimodal 서술형 채점.
손글씨 답안 사진 1장 → 단계별 채점 + 오류 지점 + 재풀이 힌트.

별도 OCR 파이프라인을 두지 않습니다. Gemini가 이미지에서 직접 수식을 읽습니다.
(Cloud Vision OCR fallback은 손글씨 인식률이 낮아 오히려 정확도를 떨어뜨립니다.)
"""
from __future__ import annotations

import os
import json
import logging

log = logging.getLogger("mathgrader.gemini")

OFFLINE = os.getenv("OFFLINE", "0").strip().lower() in {"1", "true", "yes", "on"}
PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "")
LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "global")
MODEL = os.getenv("GRADE_MODEL", "gemini-2.5-flash")

if not OFFLINE:
    if not PROJECT:
        raise RuntimeError("GOOGLE_CLOUD_PROJECT is required when OFFLINE=0")
    from google import genai
    from google.genai import types

    client = genai.Client(vertexai=True, project=PROJECT, location=LOCATION)
else:
    client = None

GRADE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "readable": {"type": "BOOLEAN", "description": "답안을 읽을 수 있는지"},
        "transcription": {"type": "STRING", "description": "학생 풀이를 LaTeX 없이 그대로 옮긴 것"},
        "total_score": {"type": "INTEGER"},
        "max_score": {"type": "INTEGER"},
        "steps": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "step_no": {"type": "INTEGER"},
                    "label": {"type": "STRING", "description": "이 단계에서 요구되는 것"},
                    "student_wrote": {"type": "STRING"},
                    "verdict": {"type": "STRING", "enum": ["correct", "partial", "wrong", "missing"]},
                    "points": {"type": "INTEGER"},
                    "max_points": {"type": "INTEGER"},
                    "comment": {"type": "STRING", "description": "채점 근거 한 문장"},
                },
                "required": ["step_no", "label", "verdict", "points", "max_points", "comment"],
            },
        },
        "first_error": {"type": "STRING", "description": "최초로 틀어진 지점. 없으면 빈 문자열"},
        "misconception": {"type": "STRING", "description": "추정되는 개념 오류 유형"},
        "hint": {"type": "STRING", "description": "답을 알려주지 않는 재도전 힌트 한 문장"},
        "teacher_note": {"type": "STRING", "description": "지도교사용 한 줄 코멘트"},
    },
    "required": ["readable", "total_score", "max_score", "steps", "first_error", "hint"],
}

SYSTEM = """당신은 한국 고등학교 수학 서술형 답안을 채점하는 교사입니다.

채점 원칙:
- 부분점수를 반드시 단계별로 분해하십시오. 최종 답이 틀려도 과정이 맞으면 점수를 주십시오.
- 최종 답이 맞아도 논리적 비약이나 근거 누락이 있으면 감점하십시오.
- 계산 실수와 개념 오류를 구분하십시오. misconception 에는 개념 오류만 적으십시오.
- first_error 는 '최초로' 틀어진 지점만 지목하십시오. 그 이후 파생 오류는 감점을 중복하지 마십시오.
- hint 는 절대 정답이나 다음 식을 알려주지 마십시오. 학생이 스스로 되돌아볼 질문 형태로 쓰십시오.
- 이미지가 흐리거나 답안이 아니면 readable=false 로 두고 나머지는 0으로 채우십시오.
- 모든 텍스트는 한국어 존댓말로 작성하십시오."""


def grade(image_bytes: bytes, mime_type: str, problem_text: str,
          rubric: str | None = None, max_score: int = 10) -> dict:
    if OFFLINE:
        # 자격증명 없이 배포 상태와 사용자 흐름을 검증하기 위한 명시적 데모 결과입니다.
        # 실제 답안 내용을 판정한 것처럼 보이지 않도록 고정 문구와 demo-stub 표식을 반환합니다.
        return {
            "readable": True,
            "transcription": "데모 모드에서는 답안 내용을 전사하지 않습니다.",
            "total_score": 0,
            "max_score": max_score,
            "steps": [{
                "step_no": 1,
                "label": "운영 연결 확인",
                "student_wrote": "이미지 업로드가 정상적으로 접수되었습니다.",
                "verdict": "missing",
                "points": 0,
                "max_points": max_score,
                "comment": "Google Cloud 운영 설정이 완료되면 실제 AI 채점이 시작됩니다.",
            }],
            "first_error": "",
            "misconception": "",
            "hint": "현재는 배포 확인용 데모 모드입니다.",
            "teacher_note": "운영 전환 전에는 채점 결과로 사용하지 마십시오.",
            "engine": "demo-stub",
            "_usage": {"input_tokens": 0, "output_tokens": 0},
        }

    rubric_block = f"\n## 채점 기준\n{rubric}" if rubric else \
        "\n## 채점 기준\n별도 기준이 없습니다. 풀이 단계를 스스로 나누고 배점을 배분하십시오."

    prompt = (
        f"## 문제\n{problem_text}\n"
        f"{rubric_block}\n"
        f"\n## 총점\n{max_score}점 만점으로 채점하십시오.\n"
        f"\n첨부된 이미지가 학생의 손글씨 답안입니다."
    )

    resp = client.models.generate_content(
        model=MODEL,
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            prompt,
        ],
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM,
            response_mime_type="application/json",
            response_schema=GRADE_SCHEMA,
            temperature=0.1,
            max_output_tokens=2048,
        ),
    )

    result = json.loads(resp.text)
    usage = resp.usage_metadata
    result["_usage"] = {
        "input_tokens": getattr(usage, "prompt_token_count", 0),
        "output_tokens": getattr(usage, "candidates_token_count", 0),
    }
    return result
