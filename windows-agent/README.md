# Stargate Windows RPA Agent

스타게이트 웹 관리자 화면에서 Windows PC의 로컬 프로그램을 안전하게 자동화하기 위한 에이전트입니다.

## v0.2 주요 기능

- Windows 프로그램 실행
- UI Automation 기반 창/컨트롤 탐색
- 버튼 클릭 / 텍스트 입력 / 단축키
- 전체 화면 스크린샷
- 열린 창 목록 조회
- Bearer Token 인증
- 실행 프로그램 allowlist
- 단일 실행 Lock으로 키보드/포커스 충돌 방지
- 최근 실행 기록 조회
- 일자별 JSONL 감사 로그
- 스타게이트 `admin/windows-automation/` 관리 콘솔

## 설치

Windows PowerShell:

```powershell
cd windows-agent
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 환경 변수

강한 랜덤 토큰을 지정하십시오.

```powershell
$env:STARGATE_AGENT_TOKEN="CHANGE-TO-A-LONG-RANDOM-SECRET"
$env:STARGATE_ALLOWED_EXECUTABLES="notepad.exe,calc.exe"
$env:STARGATE_ALLOWED_ORIGINS="https://www.stargateedu.co.kr,https://stargateedu.co.kr,http://localhost:3000"
```

필요한 프로그램을 허용하려면 `STARGATE_ALLOWED_EXECUTABLES`에 실행 파일 이름만 추가합니다.

## 실행

```powershell
uvicorn agent:app --host 127.0.0.1 --port 8765
```

상태 확인:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/health
```

## 인증된 작업 실행

```powershell
$headers = @{ Authorization = "Bearer $env:STARGATE_AGENT_TOKEN" }
$body = Get-Content .\example_notepad.json -Raw
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/run -Headers $headers -ContentType 'application/json' -Body $body
```

## 관리자 콘솔

웹 저장소의 다음 경로에 콘솔이 포함됩니다.

```text
/admin/windows-automation/
```

콘솔에서 다음 작업이 가능합니다.

1. 로컬 에이전트 상태 확인
2. Agent Token 입력
3. 메모장 / 계산기 / 열린 창 목록 템플릿 실행
4. 사용자 정의 Action JSON 실행
5. 최근 실행 결과 및 오류 확인

브라우저는 토큰을 영구 저장하지 않습니다.

## API

### `GET /health`

인증 없이 로컬 에이전트의 상태, 버전, busy 여부를 반환합니다. 토큰 값 자체는 반환하지 않습니다.

### `POST /run`

Bearer Token 필요. 여러 화면 제어 Action을 순서대로 실행합니다.

```json
{
  "name": "notepad-example",
  "actions": [
    {"type": "launch", "executable": "notepad.exe"},
    {"type": "wait", "seconds": 1},
    {"type": "list_windows"}
  ]
}
```

동시에 두 요청이 오면 후속 요청은 HTTP 409를 반환합니다. 한 개의 Windows 데스크톱에 두 자동화가 섞이지 않도록 하기 위한 설계입니다.

### `GET /runs`

Bearer Token 필요. 프로세스가 살아 있는 동안 최근 최대 100개의 실행 기록을 반환합니다.

영구 감사 기록은 로컬 `logs/runs-YYYY-MM-DD.jsonl`에 저장됩니다.

## 보안 원칙

- 기본 실행은 반드시 `127.0.0.1`을 유지하십시오.
- 포트 8765를 인터넷에 직접 노출하지 마십시오.
- 외부 원격 실행이 필요하면 공개 포트 대신 승인된 터널/VPN 또는 중계 서버 구조를 사용하십시오.
- Token은 GitHub 저장소에 커밋하지 마십시오.
- 자동화 대상 실행 파일을 allowlist로 제한하십시오.
- 결제, 송금, 개인정보 제출, 삭제 작업 등 중요한 Action은 별도의 사용자 승인 단계를 붙이는 것을 권장합니다.

## 다음 확장 후보

- 작업 템플릿 저장/버전 관리
- 작업 중지 및 timeout
- 스크린샷 관리자 화면 표시
- 자연어 → 안전한 Action JSON 변환 Planner
- Windows 서비스/시작프로그램 설치
- 예약 작업 및 반복 실행
- 작업별 사용자 승인 정책
