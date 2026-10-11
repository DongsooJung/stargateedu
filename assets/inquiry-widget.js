/*!
 * STARGATE 공용 상담 문의 위젯
 * 사용: <script src="https://stargateedu.co.kr/assets/inquiry-widget.js" data-source="lp" defer></script>
 *  - data-source : 출처 사이트 이름 (lp, blog, shop …) — 관리자 문의함에 표시
 *  - data-type   : 기본 문의 유형 (koi, math, ai_dev, publishing, partnership, other)
 *  - data-button : "false"면 떠 있는 버튼을 숨김 (페이지의 [data-inq-open] 요소로 열기)
 * 페이지 어디서든 <a data-inq-open="koi">상담</a> 처럼 열 수 있습니다.
 */
(function () {
  if (window.__sgInquiry) return; window.__sgInquiry = true;
  var me = document.currentScript || document.querySelector('script[src*="inquiry-widget"]');
  var SOURCE = (me && me.dataset.source) || location.hostname.split('.')[0];
  var DEFAULT_TYPE = (me && me.dataset.type) || '';
  var SHOW_BUTTON = !(me && me.dataset.button === 'false');
  var ENDPOINT = 'https://inftexpcnfinglwlrvsj.supabase.co/functions/v1/inquiry';
  var CATS = [['koi', 'KOI·정보올림피아드'], ['math', '수학 심화'], ['ai_dev', 'AI 개발·외주'], ['publishing', '전자출판'], ['partnership', '제휴·투자'], ['other', '기타']];
  var GRADES = ['초3 이하', '초4', '초5', '초6', '중1', '중2', '중3', '고1', '고2', '고3·N수', '성인'];

  // UTM 보존
  var utm = {};
  try { utm = JSON.parse(sessionStorage.getItem('sg_utm') || '{}'); } catch (e) {}
  var qs = new URLSearchParams(location.search), got = false;
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'].forEach(function (k) { if (qs.get(k)) { utm[k] = qs.get(k); got = true; } });
  if (got) { try { sessionStorage.setItem('sg_utm', JSON.stringify(utm)); } catch (e) {} }

  var host = document.createElement('div');
  host.style.cssText = 'position:relative;z-index:2147483000';
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  var css = [
    ':host{all:initial}*{box-sizing:border-box;font-family:"Pretendard Variable",Pretendard,-apple-system,"Noto Sans KR",system-ui,sans-serif}',
    '.fab{position:fixed;right:18px;bottom:18px;background:#4f8fff;color:#fff;border:0;border-radius:999px;padding:13px 20px;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 10px 30px rgba(20,40,90,.35)}',
    '.fab:hover{transform:translateY(-1px)}',
    '.ov{position:fixed;inset:0;background:rgba(8,12,24,.6);display:none;align-items:flex-end;justify-content:center}',
    '.ov.on{display:flex}@media(min-width:640px){.ov{align-items:center}}',
    '.box{background:#fff;color:#111827;width:100%;max-width:520px;max-height:92vh;overflow:auto;border-radius:18px 18px 0 0;padding:22px 20px 18px}',
    '@media(min-width:640px){.box{border-radius:18px}}',
    '.hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.hd h2{margin:0;font-size:18px}',
    '.x{background:none;border:0;font-size:22px;cursor:pointer;color:#6b7280;line-height:1}',
    '.cats{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px;padding:0;border:0}.cats label{cursor:pointer}',
    '.cats input{position:absolute;opacity:0}.cats span{display:inline-block;padding:7px 12px;border:1px solid #d1d5db;border-radius:999px;font-size:13px;color:#374151}',
    '.cats input:checked+span{background:#eef3ff;border-color:#4f8fff;color:#1d4ed8;font-weight:600}.cats input:focus-visible+span{outline:2px solid #4f8fff}',
    '.cats.bad span{border-color:#ef4444}',
    '.g{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media(max-width:480px){.g{grid-template-columns:1fr}}',
    '.f{display:flex;flex-direction:column;gap:4px}.f.w{grid-column:1/-1}.f label{font-size:12px;color:#4b5563}.f label b{color:#ef4444;font-weight:500}',
    '.f input,.f select,.f textarea{font-size:15px;padding:10px 11px;border:1px solid #d1d5db;border-radius:9px;background:#fff;color:#111827;width:100%}',
    '.f textarea{min-height:96px;resize:vertical}.f [aria-invalid=true]{border-color:#ef4444}',
    '.f input:focus,.f select:focus,.f textarea:focus{outline:none;border-color:#4f8fff;box-shadow:0 0 0 3px rgba(79,143,255,.18)}',
    '.ck{display:flex;gap:8px;align-items:flex-start;font-size:13px;color:#374151;margin-top:8px;line-height:1.45}.ck input{margin-top:3px}',
    '.pol{font-size:12px;color:#6b7280;background:#f9fafb;border-radius:8px;padding:8px 10px;margin:6px 0 0 24px;display:none}.pol.on{display:block}',
    '.lk{background:none;border:0;color:#2563eb;text-decoration:underline;cursor:pointer;font-size:12px;padding:0}',
    '.hp{position:absolute;left:-9999px}',
    '.ft{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px;flex-wrap:wrap}',
    '.m{font-size:13px;color:#ef4444;min-height:1em}',
    '.sb{background:#4f8fff;color:#fff;border:0;border-radius:10px;padding:12px 20px;font-size:15px;font-weight:700;cursor:pointer}.sb:disabled{opacity:.55}',
    '@media(max-width:480px){.sb{width:100%}}',
    '.done{text-align:center;padding:24px 6px}.done h3{margin:0 0 8px;font-size:18px}.done p{margin:0;color:#4b5563;font-size:14px;line-height:1.6}'
  ].join('');

  root.innerHTML = '<style>' + css + '</style>' +
    (SHOW_BUTTON ? '<button class="fab" type="button" part="button">상담 신청</button>' : '') +
    '<div class="ov" role="dialog" aria-modal="true" aria-labelledby="sgih"><div class="box">' +
    '<div class="hd"><h2 id="sgih">상담 신청</h2><button class="x" type="button" aria-label="닫기">×</button></div>' +
    '<form novalidate>' +
    '<fieldset class="cats"><legend style="font-size:12px;color:#4b5563;margin-bottom:6px">문의 유형 <b style="color:#ef4444;font-weight:500">*</b></legend>' +
    CATS.map(function (c) { return '<label><input type="radio" name="category" value="' + c[0] + '"><span>' + c[1] + '</span></label>'; }).join('') + '</fieldset>' +
    '<div class="g">' +
    '<div class="f"><label for="sg-n">성함<b>*</b></label><input id="sg-n" name="name" maxlength="40" autocomplete="name"></div>' +
    '<div class="f"><label for="sg-p">연락처<b>*</b></label><input id="sg-p" name="phone" inputmode="tel" autocomplete="tel" placeholder="010-1234-5678"></div>' +
    '<div class="f"><label for="sg-g">학생 학년</label><select id="sg-g" name="student_grade"><option value="">선택 안 함</option>' + GRADES.map(function (g) { return '<option>' + g + '</option>'; }).join('') + '</select></div>' +
    '<div class="f"><label for="sg-t">희망 상담 시간</label><input id="sg-t" name="preferred_time" maxlength="60" placeholder="예: 평일 저녁"></div>' +
    '<div class="f w"><label for="sg-m">문의 내용<b>*</b></label><textarea id="sg-m" name="message" maxlength="2000" placeholder="현재 상황과 목표를 적어 주시면 더 정확히 안내드립니다."></textarea></div>' +
    '</div>' +
    '<div class="hp" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div>' +
    '<label class="ck"><input type="checkbox" name="is_guardian"><span>학부모(법정대리인)가 작성합니다. 만 14세 미만은 보호자가 작성해 주세요.</span></label>' +
    '<label class="ck"><input type="checkbox" name="consent"><span>[필수] 개인정보 수집·이용 동의 <button type="button" class="lk">내용</button></span></label>' +
    '<div class="pol">수집 항목: 성함, 연락처, (선택) 학년·희망 시간, 문의 내용 · 목적: 상담 회신 및 일정 조율 · 보유: 문의일로부터 1년 후 파기 · 동의를 거부할 수 있으며 이 경우 전화로 문의하실 수 있습니다.</div>' +
    '<label class="ck"><input type="checkbox" name="marketing_ok"><span>[선택] 수업·설명회 소식 수신 동의</span></label>' +
    '<div class="ft"><div class="m" role="status" aria-live="polite"></div><button class="sb" type="submit">상담 신청하기</button></div>' +
    '</form><div class="done" hidden><h3>문의가 접수되었습니다</h3><p>영업일 기준 1일 이내에 연락드리겠습니다.<br>접수 번호 <b class="rid"></b></p></div>' +
    '</div></div>';

  var $ = function (s) { return root.querySelector(s); };
  var ov = $('.ov'), form = $('form'), msg = $('.m'), sbtn = $('.sb'), t0 = 0, lastFocus = null;

  function open(type) {
    lastFocus = document.activeElement;
    if (!t0) t0 = Date.now();
    var t = type || DEFAULT_TYPE;
    if (t) { var r = form.querySelector('input[name=category][value="' + t + '"]'); if (r) r.checked = true; }
    ov.classList.add('on'); document.documentElement.style.overflow = 'hidden';
    setTimeout(function () { (form.querySelector('input[name=category]:checked') ? $('#sg-n') : form.querySelector('input[name=category]')).focus(); }, 30);
  }
  function close() { ov.classList.remove('on'); document.documentElement.style.overflow = ''; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  window.StargateInquiry = { open: open, close: close };

  if (SHOW_BUTTON) $('.fab').addEventListener('click', function () { open(); });
  $('.x').addEventListener('click', close);
  ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ov.classList.contains('on')) close(); });
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-inq-open]');
    if (a) { e.preventDefault(); open(a.getAttribute('data-inq-open')); }
  });
  $('.lk').addEventListener('click', function (e) { e.preventDefault(); $('.pol').classList.toggle('on'); });

  var ph = $('#sg-p');
  ph.addEventListener('input', function () {
    var d = ph.value.replace(/\D/g, '').slice(0, 11);
    ph.value = d.indexOf('02') === 0
      ? (d.length > 9 ? d.replace(/^(02)(\d{4})(\d+)/, '$1-$2-$3') : d.replace(/^(02)(\d{3})(\d+)/, '$1-$2-$3'))
      : (d.length > 10 ? d.replace(/^(\d{3})(\d{4})(\d+)/, '$1-$2-$3') : d.replace(/^(\d{3})(\d{3})(\d+)/, '$1-$2-$3'));
  });

  function bad(name, text) {
    form.querySelectorAll('[aria-invalid]').forEach(function (x) { x.removeAttribute('aria-invalid'); });
    $('.cats').classList.toggle('bad', name === 'category');
    if (name && name !== 'category' && form.elements[name] && form.elements[name].setAttribute) { form.elements[name].setAttribute('aria-invalid', 'true'); form.elements[name].focus(); }
    msg.textContent = text || '';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = form.elements, cat = form.querySelector('input[name=category]:checked');
    if (!cat) return bad('category', '문의 유형을 선택해 주세요.');
    if (!f.name.value.trim()) return bad('name', '성함을 입력해 주세요.');
    if (!/^0\d{8,10}$/.test(f.phone.value.replace(/\D/g, ''))) return bad('phone', '연락처를 정확히 입력해 주세요.');
    if (f.message.value.trim().length < 5) return bad('message', '문의 내용을 5자 이상 입력해 주세요.');
    if (!f.consent.checked) return bad('consent', '개인정보 수집·이용에 동의해 주셔야 접수됩니다.');
    bad(null, '');
    sbtn.disabled = true; sbtn.textContent = '접수 중…';
    fetch(ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: cat.value, name: f.name.value, phone: f.phone.value, student_grade: f.student_grade.value,
        preferred_time: f.preferred_time.value, message: f.message.value, is_guardian: f.is_guardian.checked,
        consent: true, marketing_ok: f.marketing_ok.checked, website: f.website.value,
        elapsed_ms: Date.now() - t0, utm: utm, referrer: document.referrer, page: location.pathname, source_site: SOURCE
      })
    }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (j) {
        if (j.ok) {
          form.hidden = true; $('.done').hidden = false; $('.rid').textContent = j.id || '-';
          if (window.gtag) window.gtag('event', 'generate_lead', { lead_type: cat.value, source: SOURCE });
          if (window.fbq) window.fbq('track', 'Lead', { content_category: cat.value });
        } else bad(j.field, j.message || '접수에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      })
      .catch(function () { bad(null, '네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'); })
      .then(function () { sbtn.disabled = false; sbtn.textContent = '상담 신청하기'; });
  });

  (document.body ? Promise.resolve() : new Promise(function (r) { document.addEventListener('DOMContentLoaded', r); }))
    .then(function () { document.body.appendChild(host); if (/[#&?]inquiry\b/.test(location.hash + location.search)) open(); });
})();
