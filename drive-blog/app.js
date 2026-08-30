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
      smartSummary: '수학적 사고, 알고리즘, AI, 공간 데이터 분석을 교육과 실제 비즈니스 문제에 연결하는 공개 지식 운영 원칙을 정리합니다.',
      keyPoints: [
        '공개 Drive를 지식 출판 경계로 사용합니다.',
        '자료를 교육·연구·사업기획에서 재사용할 수 있게 구조화합니다.',
        '검색·분류·자동 갱신을 통해 지식 관리 부담을 줄입니다.'
      ],
      audience: 'AI·교육·데이터 연구자료를 업무에 재사용하려는 실무자',
      relatedProjects: [
        { title: 'Google Cloud API 연구', url: '/research/google-cloud/', reason: 'AI·자동화 주제가 연결됩니다.' },
        { title: 'STARGATE 전략 대시보드', url: '/strategy/', reason: '전략·사업 활용이 연결됩니다.' }
      ],
      enrichmentMode: 'heuristic',
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
      smartSummary: 'ChatGPT와 Ollama를 비교해 클라우드형 AI와 로컬 실행형 AI의 활용 차이를 빠르게 파악하는 입문 자료입니다.',
      keyPoints: [
        'ChatGPT와 Ollama의 기본 개념을 비교합니다.',
        '클라우드형과 로컬 실행형 LLM의 운영 차이를 살펴봅니다.',
        '업무 목적에 맞는 AI 실행 방식을 선택하는 참고자료입니다.'
      ],
      audience: 'AI 도구를 업무·교육에 적용하려는 실무자 · API·자동화·AI 운영 담당자',
      relatedProjects: [
        { title: 'Google Cloud API 연구', url: '/research/google-cloud/', reason: 'AI·API·자동화 주제가 연결됩니다.' },
        { title: 'PMO 운영 대시보드', url: '/pmo/', reason: 'AI 운영 자동화 관점이 연결됩니다.' }
      ],
      enrichmentMode: 'heuristic',
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
      smartSummary: 'AI 강사 활동을 준비할 때 필요한 역량과 콘텐츠 구성, 교육시장 접근 방향을 빠르게 검토할 수 있는 가이드입니다.',
      keyPoints: [
        'AI 강사에게 필요한 기본 역량을 구조화합니다.',
        '강의 콘텐츠를 구성하는 방향을 정리합니다.',
        'AI 교육시장 진입과 사업화 관점을 함께 검토합니다.'
      ],
      audience: '수학·알고리즘·AI 교육자와 학습자 · AI 도구를 업무·교육에 적용하려는 실무자',
      relatedProjects: [
        { title: 'KOI Coach', url: '/koi-coach/', reason: '교육·알고리즘 콘텐츠가 연결됩니다.' },
        { title: 'STARGATE 전략 대시보드', url: '/strategy/', reason: '교육사업 전략이 연결됩니다.' }
      ],
      enrichmentMode: 'heuristic',
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
    live: false,
    enrichment: null
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
      const url = new URL(String(value), window.location.origin);
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
      keyPoints: Array.isArray(doc.keyPoints) ? doc.keyPoints : [],
      relatedProjects: Array.isArray(doc.relatedProjects) ? doc.relatedProjects : [],
      title: doc.title || doc.sourceTitle || '제목 없는 자료',
      summary: doc.summary || 'STARGATE 공개 Drive 자료입니다.',
      smartSummary: doc.smartSummary || doc.summary || 'STARGATE 공개 Drive 자료입니다.',
      audience: doc.audience || 'STARGATE 공개 연구자료를 활용하려는 실무자',
      enrichmentMode: doc.enrichmentMode || 'heuristic',
      kind: doc.kind || 'Drive File',
      url: safeUrl(doc.url)
    };
  }

  function matches(doc) {
    const categoryOk = state.filter === 'all' || doc.categories.includes(state.filter);
    if (!categoryOk) return false;
    const q = state.query.trim().toLowerCase();
    if (!q) return true;
    const related = doc.relatedProjects.flatMap((project) => [project.title || '', project.reason || '']);
    const text = [
      doc.title, doc.summary, doc.smartSummary, doc.audience, doc.kind,
      ...doc.keyPoints, ...doc.categories, ...doc.tags, ...related
    ].join(' ').toLowerCase();
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
    const enrichmentText = state.enrichment?.aiConfigured
      ? ` · AI ${state.enrichment.aiDocuments || 0}개 / 자동 ${state.enrichment.heuristicDocuments || 0}개`
      : ' · 자동 요약 활성';
    $('#sync-text').textContent = state.live
      ? `Drive 자동 인덱스 · ${formatSync(state.generatedAt)} 기준${enrichmentText}`
      : 'Drive 인덱스를 불러오지 못해 안전한 기본 목록을 표시 중입니다.';
    $$('[data-drive-folder]').forEach((a) => { a.href = safeUrl(state.sourceUrl); });
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

  function enrichmentBadge(doc) {
    return doc.enrichmentMode === 'ai' ? 'AI 요약' : '자동 요약';
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
          <div class="tagrow"><span class="tag">${escapeHtml(enrichmentBadge(doc))}</span>${categories}</div>
          <h3>${escapeHtml(doc.title)}</h3>
          <p>${escapeHtml(doc.smartSummary)}</p>
          <div class="microtags">${tags}</div>
          <div class="meta"><span>${escapeHtml(doc.kind)}</span><span>${escapeHtml(formatDate(doc.modifiedTime))}</span></div>
          <div class="card-actions">
            <a class="btn dark" href="${escapeHtml(doc.url)}" target="_blank" rel="noopener noreferrer">원문 보기 ↗</a>
            <button class="btn summary-jump" type="button" data-doc-id="${escapeHtml(doc.id)}">스마트 요약</button>
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

  function ensureProjectLinks() {
    let node = $('#featured-projects');
    if (node) return node;
    node = document.createElement('div');
    node.id = 'featured-projects';
    node.className = 'card-actions';
    const link = $('#featured-link');
    link.insertAdjacentElement('afterend', node);
    return node;
  }

  function renderFeatured(doc) {
    const selected = normalizedDoc(doc || state.docs.find((item) => item.featured) || state.docs[0]);
    if (!selected) return;
    $('#featured-title').textContent = selected.title;
    $('#featured-summary').textContent = selected.smartSummary;
    $('#featured-kind').textContent = `${selected.kind} · ${enrichmentBadge(selected)}`;
    $('#featured-date').textContent = formatDate(selected.modifiedTime);
    $('#featured-link').href = selected.url;
    $('#featured-tags').innerHTML = selected.tags.slice(0, 6).map((tag) => `<span class="microtag">#${escapeHtml(tag)}</span>`).join('');

    const points = selected.keyPoints.slice(0, 3);
    while (points.length < 3) points.push(selected.summary);
    const pillars = $('.pillars');
    pillars.innerHTML = `
      <div class="pillar"><strong>추천 독자</strong><span>${escapeHtml(selected.audience)}</span></div>
      ${points.map((point, index) => `<div class="pillar"><strong>핵심 ${index + 1}</strong><span>${escapeHtml(point)}</span></div>`).join('')}
    `;

    const projectNode = ensureProjectLinks();
    projectNode.innerHTML = selected.relatedProjects.slice(0, 3).map((project) =>
      `<a class="btn" href="${escapeHtml(safeUrl(project.url))}" title="${escapeHtml(project.reason || '')}">${escapeHtml(project.title || '관련 프로젝트')} →</a>`
    ).join('');
  }

  function renderAll() {
    renderStats();
    renderFilters();
    renderCards();
    renderTopics();
    renderFeatured();
  }

  function upgradeP2Copy() {
    const featuredCopy = $('#featured .section-head p');
    if (featuredCopy) featuredCopy.textContent = '문서 본문에서 자동 생성한 요약·핵심 포인트·추천 독자와 연결 프로젝트를 빠르게 검토합니다.';
    const flow = $$('.flow-item');
    const steps = [
      '<b>01</b>공개 Drive에 파일 추가',
      '<b>02</b>본문 추출 + 내용 해시 생성',
      '<b>03</b>AI/자동 요약·태그·추천 독자 생성',
      '<b>04</b>관련 STARGATE 프로젝트 자동 연결',
      '<b>05</b>변경 시 GitHub Pages 재배포'
    ];
    flow.slice(0, 5).forEach((node, index) => { node.innerHTML = steps[index]; });
    const pipelineTitle = $('.pipeline h3');
    if (pipelineTitle) pipelineTitle.textContent = 'Drive → Smart Knowledge Hub';
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
      state.enrichment = data.enrichment || null;
      state.live = true;
    } catch (error) {
      console.warn('Drive archive index fallback:', error);
      state.docs = FALLBACK_DOCS.map(normalizedDoc);
      state.enrichment = null;
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
    upgradeP2Copy();
    bindEvents();
    loadIndex();
  });
})();
