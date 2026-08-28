# Wishket × NAVER Cloud 자동화 운영

## 목적

매일 공개 검색 API를 통해 Wishket AI/B2B 프로젝트 신호를 수집하고 다음 순서로 자동 처리합니다.

1. NAVER Search Web API 검색
2. Wishket 프로젝트 URL만 필터링
3. 중복 프로젝트 제거
4. ROI/NCP 적합성/예산/확장성/납기 점수화
5. 70점 이상 후보 선별
6. TOP 3 제안서 초안 생성
7. `market-radar.json` 및 `proposals/latest.md` 커밋
8. GitHub Pages Live Radar에 자동 반영

## GitHub Actions Secrets

Repository Settings → Secrets and variables → Actions에 아래 두 값을 등록합니다.

- `NAVER_SEARCH_CLIENT_ID`
- `NAVER_SEARCH_CLIENT_SECRET`

NAVER Developers에서 검색 API 사용 애플리케이션을 등록해 발급받습니다.

## 실행 일정

- 매일 09:10 KST 자동 실행
- GitHub Actions의 `Update Wishket NCP Radar`에서 수동 실행 가능

## 실패 안전 설계

- 키가 없으면 기존 데이터 유지 후 정상 종료
- 검색 API가 실패하면 파일을 덮어쓰지 않고 workflow 실패 처리
- Wishket 직접 대량 크롤링을 하지 않음
- 공개 검색 결과만으로 모집 상태를 확정하지 않음
- 실제 지원 전 Wishket 로그인 화면에서 모집 상태/세부 요구사항/예산/계약형태를 재확인

## 결과 파일

- `market-radar.json`: 전체 후보, 점수, TOP 3
- `live/index.html`: 브라우저용 실시간 레이더
- `proposals/latest.md`: TOP 3 지원 메시지 초안
