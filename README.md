# STARGATE EDU — 공식 홈페이지 (stargateedu.co.kr)

GitHub Pages로 호스팅되는 STARGATE EDU 공식 원페이지 랜딩 사이트입니다.

## 구성

- `index.html` — 메인 랜딩(한글 UTF-8, 반응형, 인쇄 대응)
- `CNAME` — 커스텀 도메인 매핑(`stargateedu.co.kr`)
- `.nojekyll` — Jekyll 빌드 비활성화(순정 HTML 직접 서빙)
- `robots.txt` — 크롤링 허용 + sitemap 지시
- `sitemap.xml` — 검색엔진 색인용
- `trade/` — 한국수출입은행 Open API 기반 무역 환율 대시보드
- `strategy/kimstudy-math/` — 익명 샘플 기반 수학·과외시장 전략 데이터 테이블
- `strategy/used-car/` — 중고차 일일 가격 전략 대시보드(페이지당 100건·CSV 내보내기)
- `strategy/job-opportunities/` — 채용·체험공고 일일 TOP 20 전략 대시보드(JSON·CSV·날짜별 보관)
- `research/seoul-realtors/` — 강남·서초·송파 공인중개사사무소 3,000개 공간지도 시범판
- `research/kimchi-premium/` — 김프 레이더: 금(KRX vs COMEX)·코인·테더 김치 프리미엄 대시보드, `scripts/update-kimchi-premium.mjs`가 매일 16:20 KST 자동 갱신
- `pmo/` — Notion 공식 API 기반 프로젝트 상태 대시보드
- `scripts/fetch-exim-rates.mjs` — 최근 영업일 환율 수집·정규화 스크립트
- `.github/workflows/update-exim-rates.yml` — 평일 11:30 KST 자동 갱신

## 배포 파이프라인

1. `main` 브랜치에 푸시 → GitHub Actions 없이 GitHub Pages가 자동 배포
2. `CNAME`이 있으면 GitHub Pages가 자동으로 `stargateedu.co.kr` 매핑
3. DNS 전환 완료 후 `Settings → Pages → Enforce HTTPS` 체크

### 환율 데이터 자동 갱신

저장소 `Settings → Secrets and variables → Actions`에 `EXIM_AUTH_KEY`를 등록하면 평일 11:30 KST에 최신 환율을 가져와 `trade/data/latest.json`을 자동 갱신합니다. 인증키는 HTML·JSON·로그에 저장하지 않습니다.

### 중고차 가격 일일 갱신

매일 09:30 KST에 승인된 CSV 또는 JSON 피드를 최대 10,000건까지 정규화하고 100건 단위 페이지로 제공합니다. Actions secret `USED_CAR_FEED_URL`에 계약된 HTTPS 피드 주소를 등록하고, 토큰형 피드는 `USED_CAR_FEED_TOKEN`을 함께 등록합니다. 직접 엔카·KB차차차 공개 화면을 수집하지 않으며, 피드가 없을 때는 실매물이 아닌 익명 샘플 데이터만 표시합니다.

### 채용·체험공고 일일 선별

매일 09:00 KST에 승인된 잡코리아 API·CSV 또는 합법적으로 내보낸 채용공고를 최대 5,000건까지 읽고, AI·데이터·GIS·도시정책·PM·교육 적합도 순으로 상위 20건을 선별합니다. Actions secret `JOB_FEED_URL`에 HTTPS CSV/JSON 주소를 등록하고 토큰형 피드는 `JOB_FEED_TOKEN`을 추가합니다. 잡코리아 도메인의 피드를 직접 연결하려면 공급 승인을 확인한 뒤 Actions variable `JOB_FEED_LICENSED=true`를 설정합니다. 결과는 `latest.json`, `latest.csv`, `archive/YYYY-MM-DD.csv`로 저장됩니다.

#### Firecrawl 확인

`scripts/check-firecrawl-access.mjs`는 대상 사이트의 `robots.txt`를 먼저 확인한 후 허용된 URL만 Firecrawl v2 Scrape API로 시험합니다. API 키는 환경변수로만 전달하고 저장소에 저장하지 않습니다. 김과외는 전체 자동 수집을 금지하므로 Firecrawl을 통한 직접 수집 대상에서도 제외합니다.

### 서울 강남권 공인중개사 공간지도

`scripts/update-seoul-realtors.mjs`는 강남·서초·송파 영업 중 중개사무소를 최대 3,000건으로 정규화합니다. `SEOUL_OPEN_DATA_KEY`가 있으면 서울 열린데이터광장 `landBizInfo`를 원장으로 사용하고, `KAKAO_REST_API_KEY`가 있으면 좌표가 없는 주소를 서버 측에서 지오코딩합니다. 두 키는 HTML·JSON에 포함하지 않습니다. 키가 없으면 공공데이터포털 전국 표준데이터의 공개 좌표만 사용하며, 좌표 미확인 레코드는 지도에서 제외됩니다.

### Notion 프로젝트 상태

`.github/workflows/update-workspace-status.yml`이 6시간마다 공식 API를 호출해 `pmo/data/latest.json`을 갱신합니다. 대시보드는 이 공개 스냅샷만 읽으므로 인증키가 브라우저에 전달되지 않습니다.

`NOTION_TOKEN` Actions secret과 `NOTION_DATA_SOURCE_IDS` Actions variable을 설정합니다. 현재 기본 데이터 소스는 프로젝트 트래커 `389627e7-cf3f-46ca-be31-2f83afd2dc6d`입니다. 프로젝트명, 상태, 진행률, 다음 행동만 공개 스냅샷에 기록하고 본문과 첨부파일은 수집하지 않습니다.

로컬 점검은 `node scripts/update-workspace-status.mjs`로 실행할 수 있습니다. 인증 정보가 없거나 API 오류가 발생하면 마지막 정상 스냅샷을 유지하고 연결 상태를 `cached`, `setup`, `error`로 표시합니다.

PMO의 `↻ 새로고침` 버튼은 공개 스냅샷을 캐시 없이 다시 조회하며, 60초마다 자동으로 새 스냅샷을 확인합니다. 원본 API 동기화가 필요하면 옆의 `API 동기화 실행` 링크에서 GitHub Actions 워크플로를 실행합니다. Notion이 `cached`로 표시되면 새로고침 버튼 문제가 아니라 `NOTION_TOKEN` 설정이 없거나 인증에 실패한 상태입니다.

## 핵심 링크

- 링크 허브: https://litt.ly/stargateedu
- 포털: https://portal.stargateedu.co.kr
- 무역 환율: https://stargateedu.co.kr/trade/
- 이메일: ceo@stargateedu.co.kr

## 운영

- **관리자**: 동수 (Stargate Corp CEO)
- **최초 배포**: 2026-04-21
- **엔진**: GitHub Pages + Cloudflare 없이 직접
