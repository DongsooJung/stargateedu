import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const RADAR_PATH = path.join(ROOT, 'strategy/naver-cloud-wishket/market-radar.json');
const PROPOSAL_DIR = path.join(ROOT, 'strategy/naver-cloud-wishket/proposals');
const PROPOSAL_PATH = path.join(PROPOSAL_DIR, 'latest.md');

const NAVER_ID = process.env.NAVER_SEARCH_CLIENT_ID || '';
const NAVER_SECRET = process.env.NAVER_SEARCH_CLIENT_SECRET || '';
const SEARCH_ENDPOINT = 'https://openapi.naver.com/v1/search/webkr.json';
const APPLY_THRESHOLD = 70;

const queries = [
  'site:wishket.com/project 위시켓 AI FastAPI B2B',
  'site:wishket.com/project 위시켓 RAG LLM AI Agent',
  'site:wishket.com/project 위시켓 OCR ERP 자동화',
  'site:wishket.com/project 위시켓 Python 백엔드 AI',
  'site:wishket.com/project 위시켓 문서 자동화 챗봇'
];

function stripHtml(value = '') {
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalWishketUrl(raw = '') {
  try {
    const url = new URL(raw);
    if (!/(^|\.)wishket\.com$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/\/project\/(\d+)\/?/);
    if (!match) return null;
    return `https://www.wishket.com/project/${match[1]}/`;
  } catch {
    return null;
  }
}

function projectId(url = '') {
  return Number(url.match(/\/project\/(\d+)\//)?.[1] || 0) || null;
}

function keywordHits(text, keywords) {
  return keywords.reduce((count, keyword) => count + (text.includes(keyword.toLowerCase()) ? 1 : 0), 0);
}

function parseBudget(text = '') {
  const normalized = text.replace(/,/g, '');
  const manwon = normalized.match(/(\d+(?:\.\d+)?)\s*만원/);
  if (manwon) return Math.round(Number(manwon[1]) * 10000);
  const won = normalized.match(/(\d{6,10})\s*원/);
  if (won) return Number(won[1]);
  return null;
}

function scoreCandidate(candidate) {
  const text = `${candidate.title} ${candidate.description}`.toLowerCase();

  const roiHits = keywordHits(text, [
    '자동화', 'erp', 'ocr', 'cs', '고객', '문서', '업무', 'b2b', '백엔드', '운영', '관리', '플랫폼'
  ]);
  const ncpHits = keywordHits(text, [
    'rag', 'llm', 'agent', '챗봇', 'ocr', '문서', 'ai', 'python', 'fastapi', '지도', '추천', '검색'
  ]);
  const expansionHits = keywordHits(text, [
    'b2b', 'erp', 'crm', '플랫폼', '서비스', '운영', '고도화', '백엔드', 'api', '기업'
  ]);
  const deliveryHits = keywordHits(text, [
    'python', 'fastapi', 'api', 'docker', 'github', 'postgresql', 'firebase', 'vector', 'rag'
  ]);

  const problem_roi = Math.min(30, 10 + roiHits * 3);
  const ncp_fit = Math.min(25, 7 + ncpHits * 3);
  const budgetValue = parseBudget(text);
  const budget = budgetValue == null ? 10 : budgetValue >= 10000000 ? 20 : budgetValue >= 5000000 ? 17 : budgetValue >= 3000000 ? 14 : 7;
  const expansion = Math.min(15, 6 + expansionHits * 2);
  const delivery = Math.min(10, 5 + deliveryHits);
  const fit_score = problem_roi + ncp_fit + budget + expansion + delivery;

  const mapping = [];
  if (/rag|llm|agent|챗봇|검색|추천/i.test(text)) mapping.push('CLOVA Studio');
  if (/ocr|문서|영수증|견적서|신청서|발주서/i.test(text)) mapping.push('CLOVA OCR');
  if (/지도|위치|배송|방문|권역/i.test(text)) mapping.push('NAVER Maps');
  if (/api|fastapi|백엔드|erp|crm|연동/i.test(text)) mapping.push('API Gateway / Cloud Functions');
  if (!mapping.length) mapping.push('CLOVA Studio');

  let recommended_offer = 'AI Quick PoC';
  if (/erp|crm|백엔드|플랫폼|구축|시스템|운영/i.test(text)) recommended_offer = 'Business Automation Build';
  if (/고도화|운영|유지보수/i.test(text)) recommended_offer = 'Managed AI Ops + Build';

  return {
    ...candidate,
    budget_value_krw: budgetValue,
    score_breakdown: { problem_roi, ncp_fit, budget, expansion, delivery },
    fit_score,
    ncp_mapping: [...new Set(mapping)],
    recommended_offer,
    apply: fit_score >= APPLY_THRESHOLD
  };
}

async function searchNaver(query) {
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set('query', query);
  url.searchParams.set('display', '100');
  url.searchParams.set('start', '1');

  const response = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': NAVER_ID,
      'X-Naver-Client-Secret': NAVER_SECRET,
      'User-Agent': 'STARGATE-Wishket-Radar/1.0'
    }
  });
  if (!response.ok) throw new Error(`NAVER Search API ${response.status}: ${await response.text()}`);
  return response.json();
}

function proposalSection(item, rank) {
  const services = item.ncp_mapping.join(', ');
  const scope = item.recommended_offer === 'AI Quick PoC'
    ? '대표 데이터 1종과 핵심 사용자 흐름을 2주 PoC로 검증한 뒤 본구축 여부를 판단하겠습니다.'
    : '핵심 업무 흐름을 먼저 분리해 4~6주 구축 범위를 고정하고, 외부 API·데이터 권한은 착수 조건으로 관리하겠습니다.';

  return `## ${rank}. ${item.title}\n\n- 적합도: **${item.fit_score}/100**\n- 권장 상품: **${item.recommended_offer}**\n- NCP 매핑: ${services}\n- 프로젝트: ${item.url}\n\n### 지원 메시지 초안\n안녕하세요. 프로젝트의 핵심을 ${item.title}로 이해했습니다. STARGATE는 Python/FastAPI 기반 업무시스템 연동과 AI 자동화 구조를 중심으로 접근합니다. ${scope}\n\n네이버클라우드 적용이 적합한 경우 ${services}를 조합하되, 특정 클라우드 자체를 목적화하지 않고 실제 KPI(처리시간, 정확도, 인력절감, 응답시간)를 기준으로 구현안을 결정하겠습니다. 착수 전 데이터/API 접근권한, 검수기준, 변경요청 범위를 먼저 확정해 일정과 비용 변동을 통제하겠습니다.\n\n### 첫 미팅 확인사항\n- 현재 수작업 처리량과 목표 KPI\n- 사용 중인 ERP/CRM/DB 및 API 제공 여부\n- 개인정보·사내정보 보안 등급과 저장 위치\n- 의사결정자 및 검수 담당자\n- PoC 후 본구축 전환 기준\n`;
}

async function main() {
  if (!NAVER_ID || !NAVER_SECRET) {
    console.log('NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET 미설정: 기존 레이더를 유지합니다.');
    return;
  }

  const previous = JSON.parse(await fs.readFile(RADAR_PATH, 'utf8'));
  const seen = new Map();

  for (const query of queries) {
    const data = await searchNaver(query);
    for (const item of data.items || []) {
      const url = canonicalWishketUrl(item.link);
      if (!url) continue;
      const id = projectId(url);
      const title = stripHtml(item.title);
      const description = stripHtml(item.description);
      if (!title || !id) continue;
      const key = String(id);
      const existing = seen.get(key);
      const candidate = { project_id: id, title, description, url, source_query: query, status: 'verify_on_wishket' };
      if (!existing || description.length > existing.description.length) seen.set(key, candidate);
    }
  }

  const candidates = [...seen.values()]
    .map(scoreCandidate)
    .sort((a, b) => b.fit_score - a.fit_score || (b.budget_value_krw || 0) - (a.budget_value_krw || 0));

  const top3 = candidates.filter(item => item.apply).slice(0, 3);
  const now = new Date().toISOString();
  const next = {
    updated_at: now,
    source: 'NAVER Search Web API → public Wishket project pages',
    note: '검색 결과는 지원 가능 상태를 보장하지 않습니다. 제출 전 Wishket 로그인 화면에서 모집 상태·전체 요구사항을 재확인합니다.',
    automation: {
      status: 'active',
      queries,
      candidates_found: candidates.length,
      apply_candidates: candidates.filter(item => item.apply).length,
      top3_count: top3.length
    },
    scoring: {
      problem_roi: 30,
      ncp_fit: 25,
      budget: 20,
      expansion: 15,
      delivery: 10,
      apply_threshold: APPLY_THRESHOLD
    },
    top3: top3.map(({ description, source_query, ...item }) => item),
    candidates: candidates.slice(0, 50),
    benchmarks: previous.benchmarks || []
  };

  await fs.writeFile(RADAR_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  await fs.mkdir(PROPOSAL_DIR, { recursive: true });

  const header = `# Wishket × NAVER Cloud TOP 3 제안서 초안\n\n갱신: ${now}\n\n> 자동 생성 초안입니다. 공개 검색 스니펫만 사용하므로 실제 제출 전 Wishket 로그인 화면에서 모집 여부, 상세 요구사항, 예산 및 계약형태를 반드시 확인합니다.\n\n`;
  const body = top3.length
    ? top3.map((item, index) => proposalSection(item, index + 1)).join('\n---\n\n')
    : '현재 70점 이상 후보를 찾지 못했습니다. 검색어·시장 상황을 다음 실행에서 다시 확인합니다.\n';
  await fs.writeFile(PROPOSAL_PATH, header + body, 'utf8');

  console.log(`Wishket radar updated: ${candidates.length} candidates, ${top3.length} top proposals.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
