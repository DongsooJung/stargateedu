# STARGATE EDU — 공식 홈페이지 (stargateedu.co.kr)

GitHub Pages로 호스팅되는 STARGATE EDU 공식 원페이지 랜딩 사이트입니다.

## 구성

- `index.html` — 메인 랜딩(한글 UTF-8, 반응형, 인쇄 대응)
- `CNAME` — 커스텀 도메인 매핑(`stargateedu.co.kr`)
- `.nojekyll` — Jekyll 빌드 비활성화(순정 HTML 직접 서빙)
- `robots.txt` — 크롤링 허용 + sitemap 지시
- `sitemap.xml` — 검색엔진 색인용
- `trade/` — 한국수출입은행 Open API 기반 무역 환율 대시보드
- `scripts/fetch-exim-rates.mjs` — 최근 영업일 환율 수집·정규화 스크립트
- `.github/workflows/update-exim-rates.yml` — 평일 11:30 KST 자동 갱신

## 배포 파이프라인

1. `main` 브랜치에 푸시 → GitHub Actions 없이 GitHub Pages가 자동 배포
2. `CNAME`이 있으면 GitHub Pages가 자동으로 `stargateedu.co.kr` 매핑
3. DNS 전환 완료 후 `Settings → Pages → Enforce HTTPS` 체크

### 환율 데이터 자동 갱신

저장소 `Settings → Secrets and variables → Actions`에 `EXIM_AUTH_KEY`를 등록하면 평일 11:30 KST에 최신 환율을 가져와 `trade/data/latest.json`을 자동 갱신합니다. 인증키는 HTML·JSON·로그에 저장하지 않습니다.

## 핵심 링크

- 링크 허브: https://litt.ly/stargateedu
- 포털: https://portal.stargateedu.co.kr
- 무역 환율: https://stargateedu.co.kr/trade/
- 이메일: ceo@stargateedu.co.kr

## 운영

- **관리자**: 동수 (Stargate Corp CEO)
- **최초 배포**: 2026-04-21
- **엔진**: GitHub Pages + Cloudflare 없이 직접
