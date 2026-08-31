(function () {
  'use strict';

  var loaderUrl = document.currentScript && document.currentScript.src
    ? document.currentScript.src
    : location.href;
  var CONFIG_URL = new URL('analytics-config.js', loaderUrl).href;
  var MAIN_HOST = 'stargateedu.co.kr';
  var BLOG_HOST = 'blog.stargateedu.co.kr';

  function init() {
    var cfg = window.STARGATE_ANALYTICS || {};
    var id = String(cfg.measurement_id || '').trim();
    if (!/^G-[A-Z0-9]+$/i.test(id)) return;
    if (window.__STARGATE_GA4_READY__) return;
    window.__STARGATE_GA4_READY__ = true;

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', id, {
      send_page_view: true,
      cookie_domain: 'auto',
      transport_type: 'beacon'
    });

    var tag = document.createElement('script');
    tag.async = true;
    tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(tag);

    document.addEventListener('click', function (event) {
      var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!anchor) return;
      var href = anchor.getAttribute('href');
      if (!href || href.charAt(0) === '#') return;

      var url;
      try { url = new URL(anchor.href, location.href); } catch (e) { return; }
      var text = (anchor.textContent || '').trim().slice(0, 120);
      var currentHost = location.hostname.replace(/^www\./, '');
      var targetHost = url.hostname.replace(/^www\./, '');

      if (targetHost === MAIN_HOST && currentHost === BLOG_HOST) {
        window.gtag('event', 'blog_to_main', { link_url: url.href, link_text: text });
      } else if (targetHost === BLOG_HOST && currentHost === MAIN_HOST) {
        window.gtag('event', 'main_to_blog', { link_url: url.href, link_text: text });
      }

      var leadPattern = /(문의|상담|견적|신청|구매|결제|contact|consult|inquiry|shop|wishket)/i;
      if (url.protocol === 'mailto:' || url.protocol === 'tel:' || leadPattern.test(text) || leadPattern.test(url.pathname)) {
        window.gtag('event', 'lead_click', { link_url: url.href, link_text: text });
      }
    }, { capture: true });
  }

  if (window.STARGATE_ANALYTICS) {
    init();
    return;
  }

  var configScript = document.createElement('script');
  configScript.async = true;
  configScript.src = CONFIG_URL + '?v=' + Math.floor(Date.now() / 3600000);
  configScript.onload = init;
  document.head.appendChild(configScript);
})();
