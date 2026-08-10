# STARGATE EDU — 공식 홈페이지 (stargateedu.co.kr)

GitHub Pages로 호스팅되는 STARGATE EDU 공식 원페이지 랜딩 사이트입니다.

## 구성

- `index.html` — 메인 랜딩(한글 UTF-8, 반응형, 인쇄 대응)
- `CNAME` — 커스텀 도메인 매핑(`stargateedu.co.kr`)
- `.nojekyll` — Jekyll 빌드 비활성화(순정 HTML 직접 서빙)
- `robots.txt` — 크롤링 허용 + sitemap 지시
- `sitemap.xml` — 검색엔진 색인용
- `trade/` — 한국수출입은행 Open API 기반 무역 환율 대시보드
- `strategy/kimstudy-math/` — 김과외 수학·과외시장 전략 데이터 테이블(페이지당 100건)
- `strategy/used-car/` — 중고차 일일 가격 전략 대시보드(페이지당 100건·CSV 내보내기)
- `strategy/job-opportunities/` — 채용·체험공고 일일 TOP 20 전략 대시보드(JSON·CSV·날짜별 보관)
- `teacher-screening/` — 승인 데이터 기반 과외학생 스크리닝 운영 화면
- `scripts/fetch-exim-rates.mjs` — 최근 영업일 환율 수집·정규화 스크립트
- `.github/workflows/update-exim-rates.yml` — 평일 11:30 KST 자동 갱신

## 배포 파이프라인

1. `main` 브랜치에 푸시 → GitHub Actions 없이 GitHub Pages가 자동 배포
2. `CNAME`이 있으면 GitHub Pages가 자동으로 `stargateedu.co.kr` 매핑
3. DNS 전환 완료 후 `Settings → Pages → Enforce HTTPS` 체크

### 환율 데이터 자동 갱신

저장소 `Settings → Secrets and variables → Actions`에 `EXIM_AUTH_KEY`를 등록하면 평일 11:30 KST에 최신 환율을 가져와 `trade/data/latest.json`을 자동 갱신합니다. 인증키는 HTML·JSON·로그에 저장하지 않습니다.

### 과외학생 주간 스크리닝

매주 월요일 09:15 KST에 최대 5,000명의 승인된 과외학생 문의를 평가하고 전략 대시보드에서 페이지당 100건씩 표시합니다. `AUTHORIZED_STUDENT_EXPORT_URL` 저장소 시크릿에 공식 API 또는 학생·보호자 동의를 받은 JSON 내보내기 URL을 등록하면 실데이터 모드로 전환됩니다. 김과외의 현재 `robots.txt`는 일반 수집 봇의 전체 경로 접근을 차단하므로 직접 대량 크롤링은 중지하며, 시크릿이 없을 때는 개인정보가 없는 익명 학생 데모 데이터만 생성합니다.

#### Supabase 이력 저장

1. Supabase SQL Editor에서 `supabase/migrations/202608020001_create_student_screening.sql`을 실행합니다.
2. 저장소 Actions secrets에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`를 등록합니다.
3. 주간 실행 시 회차 요약과 학생별 평가 결과가 `student_screening_batches`, `student_screening_candidates`에 누적 저장됩니다.

두 테이블은 RLS를 활성화하고 브라우저의 익명·로그인 사용자 접근을 차단합니다. 서버용 키는 GitHub Actions에서만 사용하며 HTML이나 JSON에 포함하지 않습니다.

### 중고차 가격 일일 갱신

매일 09:30 KST에 승인된 CSV 또는 JSON 피드를 최대 10,000건까지 정규화하고 100건 단위 페이지로 제공합니다. Actions secret `USED_CAR_FEED_URL`에 계약된 HTTPS 피드 주소를 등록하고, 토큰형 피드는 `USED_CAR_FEED_TOKEN`을 함께 등록합니다. 직접 엔카·KB차차차 공개 화면을 수집하지 않으며, 피드가 없을 때는 실매물이 아닌 익명 샘플 데이터만 표시합니다.

### 채용·체험공고 일일 선별

매일 09:00 KST에 승인된 잡코리아 API·CSV 또는 합법적으로 내보낸 채용공고를 최대 5,000건까지 읽고, AI·데이터·GIS·도시정책·PM·교육 적합도 순으로 상위 20건을 선별합니다. Actions secret `JOB_FEED_URL`에 HTTPS CSV/JSON 주소를 등록하고 토큰형 피드는 `JOB_FEED_TOKEN`을 추가합니다. 잡코리아 도메인의 피드를 직접 연결하려면 공급 승인을 확인한 뒤 Actions variable `JOB_FEED_LICENSED=true`를 설정합니다. 결과는 `latest.json`, `latest.csv`, `archive/YYYY-MM-DD.csv`로 저장됩니다.

#### Firecrawl 확인

`scripts/check-firecrawl-access.mjs`는 대상 사이트의 `robots.txt`를 먼저 확인한 후 허용된 URL만 Firecrawl v2 Scrape API로 시험합니다. API 키는 환경변수로만 전달하고 저장소에 저장하지 않습니다. 김과외는 전체 자동 수집을 금지하므로 Firecrawl을 통한 직접 수집 대상에서도 제외합니다.

## 핵심 링크

- 링크 허브: https://litt.ly/stargateedu
- 포털: https://portal.stargateedu.co.kr
- 무역 환율: https://stargateedu.co.kr/trade/
- 과외학생 스크리닝: https://www.stargateedu.co.kr/stargateedu/teacher-screening/
- 이메일: ceo@stargateedu.co.kr

## 운영

- **관리자**: 동수 (Stargate Corp CEO)
- **최초 배포**: 2026-04-21
- **엔진**: GitHub Pages + Cloudflare 없이 직접
