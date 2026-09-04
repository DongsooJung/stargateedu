# Stargate Windows RPA Agent

Windows PC에서 실행되는 로컬 자동화 에이전트입니다. 스타게이트 웹 대시보드는 이 에이전트에 작업 명령을 보내고, 실제 화면 제어는 사용자 PC에서 수행합니다.

## 지원 기능

- Windows 프로그램 실행
- UI Automation 기반 창/컨트롤 탐색
- 버튼 클릭
- 텍스트 입력
- 키보드 단축키 실행
- 대기
- 전체 화면 스크린샷
- 현재 열린 창 목록 조회

## 설치

Windows PowerShell에서:

```powershell
cd windows-agent
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 실행

```powershell
uvicorn agent:app --host 127.0.0.1 --port 8765
```

상태 확인:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/health
```

## 예시 1: 메모장 자동 입력

```powershell
$body = Get-Content .\example_notepad.json -Raw
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/run -ContentType 'application/json' -Body $body
```

동작 순서:

1. 메모장 실행
2. 1.5초 대기
3. Document 컨트롤 탐색
4. `Stargate Windows RPA test` 입력
5. Ctrl+S
6. 화면 캡처

## 예시 2: 계산기 자동화

```powershell
$body = Get-Content .\example_calculator.json -Raw
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/run -ContentType 'application/json' -Body $body
```

## API

### GET /health

에이전트 실행 여부를 확인합니다.

### POST /run

여러 화면 제어 작업을 순서대로 실행합니다.

예:

```json
{
  "actions": [
    {"type": "launch", "executable": "notepad.exe"},
    {"type": "wait", "seconds": 1},
    {"type": "list_windows"}
  ]
}
```

## 보안 원칙

현재 서버는 기본값으로 `127.0.0.1`에만 바인딩해서 실행하십시오. 인터넷에 직접 공개하지 마십시오.

스타게이트 웹 대시보드와 원격 연동할 때는 다음 단계에서 인증 토큰, 허용 작업 목록, 사용자 승인, 작업 로그를 추가하는 것을 권장합니다.

## 다음 확장 단계

- 스타게이트 관리자 대시보드의 Windows Automation 메뉴
- 작업 템플릿 저장
- 실행/중지/상태 확인
- 실행 로그 및 스크린샷 기록
- LLM이 UI 상태를 보고 다음 행동을 선택하는 Agent Planner
- 예약 실행 및 반복 작업
