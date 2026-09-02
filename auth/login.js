const statusEl = document.getElementById('auth-status');
const googleBtn = document.getElementById('google-login');
const kakaoBtn = document.getElementById('kakao-login');
const naverBtn = document.getElementById('naver-login');

const AUTH_ORIGIN = 'https://2026-plan-git-main-stargate2.vercel.app';

function setStatus(message) {
  statusEl.textContent = message;
}

function providerLabel(provider) {
  if (provider === 'google') return 'Google';
  if (provider === 'naver') return '네이버';
  return '카카오';
}

function init() {
  const params = new URLSearchParams(location.search);
  if (params.get('login') === 'success') {
    const provider = params.get('provider');
    const name = params.get('name') || '회원';
    setStatus(`${name}님, ${providerLabel(provider)} 인증이 완료되었습니다.`);
    history.replaceState({}, '', '/auth/');
    return;
  }

  const error = params.get('error');
  if (error) {
    const messages = {
      invalid_state: '로그인 요청이 만료되었거나 유효하지 않습니다. 다시 시도해 주세요.',
      google_not_configured: 'Google 서버 인증키 설정이 필요합니다.',
      kakao_not_configured: '카카오 서버 인증키 설정이 필요합니다.',
      naver_not_configured: '네이버 서버 인증키 설정이 필요합니다.',
      google_token_failed: 'Google 인증 토큰 발급에 실패했습니다.',
      kakao_token_failed: '카카오 인증 토큰 발급에 실패했습니다.',
      naver_token_failed: '네이버 인증 토큰 발급에 실패했습니다.',
      google_profile_failed: 'Google 회원 정보를 확인하지 못했습니다.',
      kakao_profile_failed: '카카오 회원 정보를 확인하지 못했습니다.',
      naver_profile_failed: '네이버 회원 정보를 확인하지 못했습니다.'
    };
    setStatus(messages[error] || '로그인을 완료하지 못했습니다. 다시 시도해 주세요.');
    return;
  }

  setStatus('로그인 제공자를 선택해 주세요.');
}

function signIn(provider) {
  setStatus(`${providerLabel(provider)} 로그인 페이지로 이동합니다.`);
  location.href = `${AUTH_ORIGIN}/api/stargate-auth/${provider}`;
}

googleBtn.addEventListener('click', () => signIn('google'));
kakaoBtn.addEventListener('click', () => signIn('kakao'));
naverBtn.addEventListener('click', () => signIn('naver'));

init();
