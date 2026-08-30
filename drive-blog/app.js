(() => {
  'use strict';

  const CATEGORY_LABELS = {
    all: '전체',
    ai: 'AI',
    education: '교육',
    urban: '도시·GIS',
    strategy: '전략',
    automation: '자동화',
    publication: '출판·보고서'
  };

  const FALLBACK_DOCS = [
    {
      id: '18VgljsswrJXGJ_gL63z1QvsIWIoZvdWQuFTncueB1-A',
      title: 'STARGATE 공개 지식 아카이브 — AI·교육·데이터 전략',
      summary: '수학적 사고, 알고리즘, AI, 공간 데이터 분석을 교육과 실제 비즈니스 문제에 연결하는 STARGATE의 공개 지식 운영 원칙을 정리한 문서입니다.',
      url: 'https://docs.google.com/document/d/18VgljsswrJXGJ_gL63z1QvsIWIoZvdWQuFTncueB1-A/edit?usp=drivesdk',
      kind: 'Google Docs',
      categories: ['ai', 'education', 'strategy'],
      tags: ['AI', '교육', '데이터', '전략', 'STARGATE'],
      featured: true,
      modifiedTime: null
    },
    {
      id: '1Zq9NLgzUqg_HF9iI05JBYaW1HDhgdi_P',
      title: 'ChatGPT와 Ollama 이해하기',
      summary: 'ChatGPT와 로컬 LLM 도구 Ollama의 개념과 차이를 빠르게 파악하기 위한 입문 자료입니다. 클라우드형 AI와 로컬 실행형 AI의 활용 방향을 비교할 때 참고할 수 있습니다.',
      url: 'https://drive.google.com/file/d/1Zq9NLgzUqg_HF9iI05JBYaW1HDhgdi_P/view?usp=drivesdk',
      kind: 'PDF',
      categories: ['ai', 'automation', 'publication'],
      tags: ['ChatGPT', 'Ollama', 'LLM', '로컬AI'],
      featured: false,
      modifiedTime: null
    },
    {
      id: '1fI_OuNQigTekDDpEm-OXCUGQ3uu6AI7y',
      title: '2026 AI 강사 되는 법 가이드',
      summary: 'AI 강사 활동을 준비할 때 필요한 역량, 콘텐츠 구성, 교육시장 접근 방향을 정리한 전자책형 가이드입니다.',
      url: 'https://drive.google.com/file/d/1fI_OuNQigTekDDpEm-OXCUGQ3uu6AI7y/view?usp=drivesdk',
      kind: 'PDF',
      categories: ['education', 'ai', 'publication'],
      tags: ['AI강사', 'AI교육', '전자책', '교육사업'],
      featured: false,
      modifiedTime: null
    }
  ];

  const state = {
    docs: FALLBACK_DOCS,
    filter: 'all',
    query: '',
    generatedAt: null,
    sourceUrl: 'https://drive.google.com/drive/folders/18wK4G_-jzJHsLsvM3Ka5oWjrQChoK9Y4',
    live: false
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value));
      return ['https:', 'http:'].includes(url.protocol) ? url.href : '#';
    } catch {
      return '#';
    }
  }

  function formatDate(value) {
    if (!value) return '공개 자료';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '공개 자료';
    return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }

  function formatSync(value) {
    if (!value) return '초기 인덱스';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '초기 인덱스';
    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      timeZone: 'Asia/Seoul'
    }).format(d);
  }

  function normalizedDoc(doc) {
    return {
      ...doc,
      categories: Array.isArray(doc.categories) ? doc.categories : [],
      tags: Array.isArray(doc.tags) ? doc.tags : [],
      title: doc.title || doc.sourceTitle || '제목 없는 자료',
      summary: doc.summary || 'STARGATE 공개 Drive 자료입니다.',
      kind: doc.kind || 'Drive File',
      url: safeUrl(doc.url)
    };
  }

  function matches(doc) {
    const categoryOk = state.filter === 'all' || doc.categories.includes(state.filter);
    if (!categoryOk) return false;
    const q = state.query.trim().toLowerCase();
    if (!q) return true;
    const text = [doc.title, doc.summary, doc.kind, ...doc.categories, ...doc.tags].join(' ').toLowerCase();
    return text.includes(q);
  }

  function renderStats() {
    const docs = state.docs;
    const pdf = docs.filter((d) => d.kind === 'PDF').length;
    const categories = new Set(docs.flatMap((d) => d.categories)).size;
    $('#stat-docs').textContent = String(docs.length);
    $('#stat-pdf').textContent = String(pdf);
    $('#stat-topics').textContent = String(categories);
    $('#stat-sync').textContent = state.live ? 'LIVE' : 'SAFE';
    $('#sync-text').textContent = state.live
      ? `Drive 자동 인덱스 · ${formatSync(state.generatedAt)} 기준`
      : 'Drive 인덱스를 불러오지 못해 안전한 기본 목록을 표시 중입니다.';
    const folderLinks = $$('[data-drive-folder]');
    folderLinks.forEach((a) => { a.href = safeUrl(state.sourceUrl); });
  }

  function renderFilters() {
    const counts = {};
    Object.keys(CATEGORY_LABELS).forEach((key) => { counts[key] = 0; });
    counts.all = state.docs.length;
    state.docs.forEach((doc) => doc.categories.forEach((category) => { counts[category] = (counts[category] || 0) + 1; }));

    $$('.filter').forEach((button) => {
      const key = button.dataset.filter;
      const label = CATEGORY_LABELS[key] || key;
      button.textContent = `${label} ${counts[key] || 0}`;
      button.classList.toggle('active', key === state.filter);
    });
  }

  function renderCards() {
    const target = $('#public-cards');
    const docs = state.docs.filter(matches);
    $('#result-count').textContent = `${docs.length}개 자료`;
    $('#empty-state').hidden = docs.length !== 0;

    target.innerHTML = docs.map((doc) => {
      const categories = doc.categories.slice(0, 3).map((category) =>
        `<span class="tag">${escapeHtml(CATEGORY_LABELS[category] || category)}</span>`
      ).join('');
      const tags = doc.tags.slice(0, 4).map((tag) => `<span class="microtag">#${escapeHtml(tag)}</span>`).join('');
      return `
        <article class="card">
          <div class="tagrow">${categories}</div>
          <h3>${escapeHtml(doc.title)}</h3>
          <p>${escapeHtml(doc.summary)}</p>
          <div class="microtags">${tags}</div>
          <div class="meta"><span>${escapeHtml(doc.kind)}</span><span>${escapeHtml(formatDate(doc.modifiedTime))}</span></div>
          <div class="card-actions">
            <a class="btn dark" href="${escapeHtml(doc.url)}" target="_blank" rel="noopener noreferrer">원문 보기 ↗</a>
            <button class="btn summary-jump" type="button" data-doc-id="${escapeHtml(doc.id)}">핵심 요약</button>
          </div>
        </article>`;
    }).join('');

    $$('.summary-jump').forEach((button) => {
      button.addEventListener('click', () => {
        const doc = state.docs.find((item) => item.id === button.dataset.docId);
        if (!doc) return;
        renderFeatured(doc);
        $('#featured').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function renderTopics() {
    const target = $('#topic-grid');
    const topicOrder = ['ai', 'education', 'urban', 'strategy', 'automation', 'publication'];
    const descriptions = {
      ai: 'LLM, ChatGPT, Gemini, Agent와 AI 활용 자료',
      education: '수학·알고리즘·AI 교육과 강의 자료',
      urban: 'GIS, 공간분석, 스마트시티 연구 자료',
      strategy: '시장·사업·정책·기업 전략 자료',
      automation: 'API, MCP, 워크플로와 운영 자동화',
      publication: '전자책, 보고서, 가이드와 공개 출판물'
    };
    target.innerHTML = topicOrder.map((key) => {
      const count = state.docs.filter((doc) => doc.categories.includes(key)).length;
      return `
        <button class="topic" type="button" data-topic="${key}">
          <span class="topic-key">${escapeHtml(key.toUpperCase())}</span>
          <strong>${escapeHtml(CATEGORY_LABELS[key])}</strong>
          <span>${escapeHtml(descriptions[key])}</span>
          <b>${count}개 자료 →</b>
        </button>`;
    }).join('');
    $$('.topic').forEach((button) => {
      button.addEventListener('click', () => {
        state.filter = button.dataset.topic;
        renderAll();
        $('#archive').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function renderFeatured(doc) {
    const selected = normalizedDoc(doc || state.docs.find((item) => item.featured) || state.docs[0]);
    if (!selected) return;
    $('#featured-title').textContent = selected.title;
    $('#featured-summary').textContent = selected.summary;
    $('#featured-kind').textContent = selected.kind;
    $('#featured-date').textContent = formatDate(selected.modifiedTime);
    $('#featured-link').href = selected.url;
    $('#featured-tags').innerHTML = selected.tags.slice(0, 6).map((tag) => `<span class="microtag">#${escapeHtml(tag)}</span>`).join('');
  }

  function renderAll() {
    renderStats();
    renderFilters();
    renderCards();
    renderTopics();
    renderFeatured();
  }

  async function loadIndex() {
    try {
      const response = await fetch(`./data.json?v=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.documents) || data.documents.length === 0) throw new Error('No documents in Drive index');
      state.docs = data.documents.map(normalizedDoc);
      state.generatedAt = data.generatedAt || null;
      state.sourceUrl = data.source?.folderUrl || state.sourceUrl;
      state.live = true;
    } catch (error) {
      console.warn('Drive archive index fallback:', error);
      state.docs = FALLBACK_DOCS.map(normalizedDoc);
      state.live = false;
    }
    renderAll();
  }

  function bindEvents() {
    $('#archive-search').addEventListener('input', (event) => {
      state.query = event.target.value;
      renderCards();
    });
    $$('.filter').forEach((button) => {
      button.addEventListener('click', () => {
        state.filter = button.dataset.filter;
        renderFilters();
        renderCards();
      });
    });
    $('#clear-search').addEventListener('click', () => {
      state.query = '';
      state.filter = 'all';
      $('#archive-search').value = '';
      renderFilters();
      renderCards();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    loadIndex();
  });
})();
