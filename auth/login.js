const statusEl = document.getElementById('auth-status');
const kakaoBtn = document.getElementById('kakao-login');
const naverBtn = document.getElementById('naver-login');

const CONFIG_URL = './public-config.json';
let supabaseClient = null;
let config = null;

function setStatus(message) {
  statusEl.textContent = message;
}

async function loadConfig() {
  const response = await fetch(`${CONFIG_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('CONFIG_NOT_FOUND');
  const data = await response.json();
  if (!data.supabaseUrl || !data.supabaseAnonKey) throw new Error('CONFIG_INCOMPLETE');
  return data;
}

async function init() {
  try {
    config = await loadConfig();
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    supabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true }
    });

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session?.user) {
      setStatus(`${session.user.user_metadata?.name || session.user.email || '회원'}님, 로그인되어 있습니다.`);
      kakaoBtn.textContent = '카카오 계정으로 다시 로그인';
      naverBtn.textContent = '네이버 계정으로 다시 로그인';
    } else {
      setStatus('로그인 제공자를 선택해 주세요.');
    }
  } catch (error) {
    kakaoBtn.disabled = true;
    naverBtn.disabled = true;
    setStatus('운영자 인증 설정이 아직 완료되지 않았습니다. Supabase 공개 설정을 등록하면 로그인 기능이 활성화됩니다.');
  }
}

async function signIn(provider) {
  if (!supabaseClient) return;
  const redirectTo = `${location.origin}/auth/`;
  setStatus(`${provider === 'kakao' ? '카카오' : '네이버'} 로그인 페이지로 이동합니다.`);

  const providerName = provider === 'naver' ? (config.naverProvider || 'naver') : 'kakao';
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: providerName,
    options: { redirectTo }
  });

  if (error) setStatus(`로그인을 시작하지 못했습니다: ${error.message}`);
}

kakaoBtn.addEventListener('click', () => signIn('kakao'));
naverBtn.addEventListener('click', () => signIn('naver'));

init();
