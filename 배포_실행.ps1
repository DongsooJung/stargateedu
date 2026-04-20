<#
.SYNOPSIS
  STARGATE EDU 사이트를 GitHub Pages로 배포하는 스크립트
.DESCRIPTION
  1) Git 초기화 → main 브랜치 생성 → 커밋
  2) gh CLI로 원격 리포 생성·푸시 (또는 수동 URL 등록)
  3) GitHub Pages 설정 + CNAME 검증 안내
.NOTES
  Author: 동수 (Stargate Corp)
  Date  : 2026-04-21
  Run   : PowerShell 관리자 권한에서 실행 권장 (선택)
         >  powershell -ExecutionPolicy Bypass -File .\배포_실행.ps1
#>

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding          = [System.Text.Encoding]::UTF8

# ====== 사용자 설정 (필요시 수정) ======
$GH_USER   = 'dongsoojung'          # GitHub 아이디
$GH_REPO   = 'stargateedu'          # 리포 이름 (소문자 권장)
$GH_BRANCH = 'main'
$CUSTOM_DOMAIN = 'stargateedu.co.kr'
$REPO_DIR  = 'C:\Users\DONGSOO_PC\Desktop\Cowork(260323)\스타게이트에듀_GitHub_배포'
# =====================================

function Write-Step($msg) { Write-Host "`n[→] $msg" -ForegroundColor Cyan }
function Write-OK  ($msg) { Write-Host "[✓] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Err ($msg) { Write-Host "[✗] $msg" -ForegroundColor Red }

# ── 사전 점검 ──
Write-Step '사전 점검'
if (-not (Test-Path $REPO_DIR)) { Write-Err "디렉토리 없음: $REPO_DIR"; exit 1 }
Set-Location $REPO_DIR
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Err 'git 미설치. https://git-scm.com/download/win 에서 설치 후 재실행하세요.'; exit 1
}
$useGh = [bool](Get-Command gh -ErrorAction SilentlyContinue)
Write-OK ("git 존재, gh CLI: " + ($(if($useGh){'있음'}else{'없음 → 수동 리포 생성 안내'})))

# ── Git 초기화 ──
Write-Step 'Git 초기화 및 커밋'
if (-not (Test-Path '.git')) {
    git init | Out-Null
    git branch -M $GH_BRANCH
}
git add --all
git -c user.email="ceo@stargateedu.co.kr" -c user.name="$GH_USER" commit -m "feat: initial STARGATE EDU landing page (2026-04-21)" 2>$null
Write-OK '커밋 완료'

# ── 원격 등록/생성 ──
Write-Step '원격 리포 연결'
$remoteUrl = "https://github.com/$GH_USER/$GH_REPO.git"

if ($useGh) {
    # gh 인증 확인
    $ghAuth = gh auth status 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Warn 'gh 미인증. `gh auth login` 을 먼저 수행한 뒤 스크립트를 재실행하세요.'
        Write-Host "  > gh auth login --web" -ForegroundColor Yellow
        exit 1
    }
    # 리포 존재 확인
    gh repo view "$GH_USER/$GH_REPO" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Step "gh CLI로 신규 리포 생성: $GH_USER/$GH_REPO"
        gh repo create "$GH_USER/$GH_REPO" --public --source "." --remote origin --push --description "STARGATE EDU 공식 홈페이지"
        Write-OK '리포 생성 + 푸시 완료'
    } else {
        Write-OK '기존 리포 발견 → 원격 등록 후 푸시'
        git remote remove origin 2>$null
        git remote add origin $remoteUrl
        git push -u origin $GH_BRANCH --force
    }
} else {
    # 수동 생성 안내
    Write-Warn '먼저 GitHub에서 수동으로 리포를 만드셔야 합니다:'
    Write-Host "  1) https://github.com/new 접속" -ForegroundColor Yellow
    Write-Host "  2) Repository name: $GH_REPO  (Public 선택, README/gitignore 생성 모두 해제)" -ForegroundColor Yellow
    Write-Host "  3) 생성 완료 후 이 스크립트를 다시 실행하세요." -ForegroundColor Yellow

    git remote remove origin 2>$null
    git remote add origin $remoteUrl
    Write-Step "원격 등록: $remoteUrl"
    Write-Step "푸시 시도 (GitHub 로그인 창이 뜨면 로그인하세요)"
    git push -u origin $GH_BRANCH
    Write-OK '푸시 완료'
}

# ── GitHub Pages 활성화 (gh가 있을 때 자동) ──
if ($useGh) {
    Write-Step 'GitHub Pages 설정 자동 활성화 (main 브랜치 루트)'
    try {
        gh api -X POST "repos/$GH_USER/$GH_REPO/pages" -f "source[branch]=$GH_BRANCH" -f "source[path]=/" 2>$null | Out-Null
    } catch { }
    try {
        gh api -X PUT "repos/$GH_USER/$GH_REPO/pages" -F "https_enforced=true" 2>$null | Out-Null
    } catch { }
    Write-OK 'Pages 활성화 + HTTPS 강제 시도 완료'
}

# ── 최종 안내 ──
Write-Step '다음 단계 (DNS 전환)'
Write-Host "현재 stargateedu.co.kr 은 Cafe24(222.122.39.84) 를 가리킵니다." -ForegroundColor White
Write-Host "아래 DNS 레코드로 교체해야 GitHub Pages + HTTPS가 정상 작동합니다." -ForegroundColor White
Write-Host ""
Write-Host "  A     @     185.199.108.153" -ForegroundColor Green
Write-Host "  A     @     185.199.109.153" -ForegroundColor Green
Write-Host "  A     @     185.199.110.153" -ForegroundColor Green
Write-Host "  A     @     185.199.111.153" -ForegroundColor Green
Write-Host "  CNAME www   $GH_USER.github.io" -ForegroundColor Green
Write-Host ""
Write-Host "Cafe24 DNS 관리 콘솔: https://hosting.cafe24.com/ → 도메인 → DNS 관리" -ForegroundColor Cyan
Write-Host "자세한 절차는 같은 폴더의 'DNS_전환_가이드.md' 를 참고하세요." -ForegroundColor Cyan
Write-Host ""
Write-OK "배포 흐름 종료. 약 10~30분 내 https://$CUSTOM_DOMAIN 에서 확인 가능합니다."
