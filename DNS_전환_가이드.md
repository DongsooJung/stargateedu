# stargateedu.co.kr DNS 전환 가이드 — Cafe24 → GitHub Pages

작성일: 2026-04-21
작성자: Stargate Corp / 동수

---

## 현재 상태 (전환 전)

```
stargateedu.co.kr  →  A     222.122.39.84   (Cafe24 공유 호스팅)
HTTPS              →  ❌ ERR_CONNECTION_REFUSED
콘텐츠             →  "홈페이지 준비중입니다" Cafe24 기본 템플릿
```

## 전환 후 목표

```
stargateedu.co.kr     →  GitHub Pages (HTTPS 자동 발급)
www.stargateedu.co.kr →  dongsoojung.github.io (CNAME)
콘텐츠                →  STARGATE EDU 공식 원페이지 랜딩
```

---

## 1단계 · GitHub 리포 배포 (3분)

같은 폴더의 `배포_실행.ps1` 을 실행하시면 자동 처리됩니다.

```powershell
cd "C:\Users\DONGSOO_PC\Desktop\Cowork(260323)\스타게이트에듀_GitHub_배포"
powershell -ExecutionPolicy Bypass -File .\배포_실행.ps1
```

**사전 요구 사항**

- `git` 설치 — 미설치 시 https://git-scm.com/download/win
- `gh` CLI 권장 — 미설치 시 https://cli.github.com/ 에서 Windows용 설치 후
  한 번만 `gh auth login --web` 로 인증
- 리포 이름 기본값은 `stargateedu` (스크립트 상단에서 수정 가능)

스크립트가 자동 수행하는 것:
1. git 초기화 + `main` 브랜치 생성
2. 전체 파일 커밋 (커밋 시각: 2026-04-21)
3. GitHub에 `dongsoojung/stargateedu` 퍼블릭 리포 생성
4. `CNAME` 파일이 존재하므로 GitHub Pages가 자동으로 `stargateedu.co.kr` 매핑
5. Pages 활성화 + HTTPS Enforce

실행 완료 직후 `https://dongsoojung.github.io/stargateedu/` 에서 임시 미리보기 가능
(커스텀 도메인 적용 전 URL이므로 정식 링크는 아님)

---

## 2단계 · Cafe24 DNS 레코드 교체 (5분)

### 2-1. Cafe24 DNS 관리 진입

1. https://hosting.cafe24.com/ 접속 → 상단 아이콘 `나의서비스관리` 클릭
2. 좌측 메뉴 → **도메인** → **DNS 관리** 선택
3. 도메인 목록에서 `stargateedu.co.kr` 선택

### 2-2. 기존 A 레코드 삭제

기존에 등록된 레코드 중 아래와 같은 것이 있다면 **삭제**하십시오.

| 타입 | 호스트 | 값 | 비고 |
|---|---|---|---|
| A | @ | 222.122.39.84 | Cafe24 공유호스팅 IP (제거) |
| A | www | 222.122.39.84 | Cafe24 www (제거) |

### 2-3. 신규 레코드 4+1건 추가

루트 도메인 `@` 에 GitHub Pages A 레코드 4개를 **모두** 추가합니다
(GitHub Pages는 Anycast로 4개 IP를 동시 운영합니다).

| 타입 | 호스트 | 값 | TTL |
|---|---|---|---|
| A | @ | 185.199.108.153 | 600 |
| A | @ | 185.199.109.153 | 600 |
| A | @ | 185.199.110.153 | 600 |
| A | @ | 185.199.111.153 | 600 |
| CNAME | www | dongsoojung.github.io | 600 |

**주의**: Cafe24 UI에서 호스트 필드에 `@` 을 입력하거나 빈칸으로 두면
루트 도메인 지정이 됩니다. 인터페이스에 따라 다르므로 안내에 따르세요.

### 2-4. 적용 및 전파 대기

- 저장 버튼 → 약 10~30분 내 전세계 DNS 전파 완료
- 확인 명령 (PowerShell):

```powershell
nslookup stargateedu.co.kr 8.8.8.8
# 예상 응답: 185.199.108.153 등 4개 IP
```

또는 https://dnschecker.org/#A/stargateedu.co.kr 에서 전파 상태 시각 확인

---

## 3단계 · GitHub Pages HTTPS 발급 대기 (5~30분)

1. https://github.com/dongsoojung/stargateedu/settings/pages 접속
2. `Custom domain` 에 `stargateedu.co.kr` 이 입력되어 있는지 확인
   (`CNAME` 파일 덕분에 자동 입력됨)
3. 아래 상태 진행 순서 확인:
   - ⏳ "DNS Check in progress" (DNS 전파 중)
   - ✅ "Your site is live at https://stargateedu.co.kr"
   - ✅ 하단 **Enforce HTTPS** 체크박스 활성화
4. **Enforce HTTPS** 체크 → Let's Encrypt 자동 발급 완료 (수 분)

---

## 4단계 · 검증 체크리스트

```powershell
# 1) 응답 코드 확인
curl.exe -I https://stargateedu.co.kr
# 기대: HTTP/2 200

# 2) 리디렉션 확인 (HTTP → HTTPS)
curl.exe -I http://stargateedu.co.kr
# 기대: 301 Moved Permanently → Location: https://stargateedu.co.kr/

# 3) www 동작 확인
curl.exe -I https://www.stargateedu.co.kr
# 기대: 301 또는 200

# 4) TLS 인증서 확인
curl.exe -vI https://stargateedu.co.kr 2>&1 | Select-String "issuer|subject"
# 기대: issuer: Let's Encrypt Authority
```

브라우저 테스트: https://stargateedu.co.kr → STARGATE EDU 랜딩 표시 확인

---

## 롤백 절차 (문제 발생 시)

GitHub Pages 배포 이슈로 원상복귀가 필요한 경우:

1. Cafe24 DNS 관리에서 4개 A 레코드(185.199.x) 삭제
2. 기존 A 레코드 `222.122.39.84` 재등록
3. CNAME `www → dongsoojung.github.io` 제거 또는 Cafe24 기본값으로 변경

DNS 변경은 즉시 반영되지 않으므로 15~30분 대기 후 `nslookup` 으로 확인.

---

## 자주 묻는 질문

**Q1. Cafe24 호스팅 서비스를 해지해도 되나요?**
도메인 등록(NS)까지 Cafe24가 관리하고 있다면 **도메인은 유지**하시되
호스팅만 해지 가능합니다. DNS 관리 권한만 확보되어 있으면 됩니다.
해지 전 반드시 DNS A 레코드가 GitHub Pages로 정상 이관되었는지 확인.

**Q2. 워드프레스 데이터는 어떻게 되나요?**
현재 `stargate8224` 계정에는 `애드센스 워드프레스 Basic` 이 붙어 있지만
운영 사이트는 `stargate8224.mycafe24.com` 이고 `stargateedu.co.kr` 과는
별개입니다. 이전 전 백업을 원하시면 `계정관리 → 백업받기/올리기` 에서
`.tar.gz` 로 내려받을 수 있습니다.

**Q3. 이메일 `ceo@stargateedu.co.kr` 은 계속 쓸 수 있나요?**
이메일이 Cafe24 메일 서비스로 운영 중이라면 **MX 레코드는 유지**하셔야
합니다. A 레코드만 교체하고 MX는 손대지 마십시오.
(현재 MX 상태는 `nslookup -type=mx stargateedu.co.kr` 로 확인 가능)

**Q4. HTTPS 발급이 30분 넘게 안 됩니다.**
- Pages 설정 화면에서 `Remove` → 다시 `Save` 버튼 클릭
- `CNAME` 파일 내용이 정확히 `stargateedu.co.kr` 한 줄인지 확인
- DNS 전파가 100% 완료되었는지 dnschecker.org 로 재확인

---

## 예상 소요 시간 요약

| 단계 | 시간 |
|---|---|
| 1단계: 리포 생성+푸시 | 3분 |
| 2단계: DNS 레코드 교체 | 5분 |
| 3단계: DNS 전파 + HTTPS 발급 | 10~30분 |
| 4단계: 검증 | 2분 |
| **총 소요** | **20~40분** |

비용: 0원 (GitHub Pages 무료 + Cafe24 도메인 유지비만)
