# 공공데이터포털 자동 수집 파이프라인

공공데이터포털(data.go.kr) API를 24시간 주기로 자동 호출하여 CSV 저장 및 Notion DB 적재까지 수행하는 파이프라인입니다.

## 구성

| 파일 | 역할 |
|------|------|
| `datago_client.py` | **공통 API 클라이언트** (모든 호출이 경유) |
| `preflight.py` | 실제 키 사전 검증 · 응답 스키마 덤프 |
| `public_data_collector.py` | 범용 수집기 (부동산 / 상권 / 기상 / 소상공인) |
| `sbiz_collector.py` | 소상공인 상권정보 전용 수집기 (연구용) |
| `notion_pusher.py` | Notion DB 자동 적재 모듈 |
| `n8n_workflow_public_data.json` | n8n 워크플로우 (임포트용) |
| `setup.sh` | systemd / cron 배포 스크립트 |
| `키등록_및_검증.ps1` | Windows 인증키 등록 + 검증 |
| `깃허브_푸시.ps1` | GitHub 푸시 자동화 |
| `AGENTS.md` | 코딩 에이전트 지시문 |
| `TASKS.md` | 미완 작업 명세 |

## 설치

```bash
pip install -r requirements.txt

export DATA_GO_KR_API_KEY="발급받은_인증키"
export NOTION_TOKEN="노션_인테그레이션_토큰"   # 선택
```

인코딩 키·디코딩 키 모두 사용 가능합니다. `DataGoKrClient`가 형식을 자동 판별합니다.

> **주의 — serviceKey 이중 인코딩**
>
> 인코딩 키에는 `%2F`, `%2B`, `%3D`가 포함되어 있습니다. 이를 `requests`의 `params=`로 전달하면 `%`가 `%25`로 재인코딩되어 서버가 잘못된 키를 수신하고 **전량 HTTP 403**이 발생합니다.
> 이 저장소의 모든 호출은 `DataGoKrClient`를 경유하며, 해당 클래스가 URL을 직접 구성해 이 문제를 차단합니다. `requests`를 직접 호출하지 마십시오.

### 사전 검증 (실수집 전 필수)

```bash
python3 preflight.py
python3 preflight.py --dump-schema
```

Windows에서는 아래 스크립트가 키 등록부터 검증까지 처리합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\키등록_및_검증.ps1
```

## 실행

### 범용 수집기

```bash
python3 public_data_collector.py --once
python3 public_data_collector.py
python3 public_data_collector.py --key "인증키"
```

### 소상공인 상권 수집기

```bash
python3 sbiz_collector.py --mode dong
python3 sbiz_collector.py --mode industry --dong 1168011800
python3 sbiz_collector.py --mode grid --bbox 127.02,37.49,127.07,37.52
python3 sbiz_collector.py --mode all --notion
```

### 서버 배포

```bash
bash setup.sh
```

## 소상공인 API 수집 모드

| 모드 | 엔드포인트 | 연구 활용 |
|------|-----------|----------|
| `dong` | `storeListInDong` | 행정동 패널데이터 기본 단위 |
| `industry` | `storeListInUpjong` | 업종별 생존분석 코호트 |
| `grid` | `storeListInRectangle` | GWR 그리드 셀 집계 |
| — | `storeListInRadius` | 접근성 / 반경 분석 |
| — | `storeListInBuilding` | 헤도닉 모형 결합 |
| — | `storeZoneInRadius` | 상권 경계 폴리곤 |

업종 대분류 코드: `Q`(음식) `D`(소매) `F`(생활서비스) `N`(학문/교육) `R`(부동산) `S`(숙박) `P`(관광/여가) `G`(스포츠)

## n8n 파이프라인

```text
⏰ 24시간 트리거
    ↓ (병렬)
부동산 · 상권정보 · 기상예보 · 소상공인
    ↓
응답 파싱/통합
    ↓
CSV 저장 · Notion DB · 실패 알림
```

## 주요 제약사항

- 호출 간 **1초 이상 지연** 필수
- 요청당 최대 **1000행**
- 일부 API는 버전 접미사가 필요합니다.
- 날짜 파라미터 형식은 API마다 다릅니다.

## 개발

```bash
python3 -m pytest tests/ -q
python3 -m pyflakes *.py tests/*.py
```

배포 전 네트워크 비의존 테스트 **32건을 통과**했습니다.

## 라이선스

MIT
