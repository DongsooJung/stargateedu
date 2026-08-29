import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const OUT = resolve("strategy/pet-data-radar/data/latest.json");
const KEY = (process.env.DATA_GO_KR_API_KEY || "").trim();
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

const sources = [
  { id: "hospital", label: "동물병원", url: "https://apis.data.go.kr/1741000/animal_hospitals/info", meta: "https://www.data.go.kr/data/15154952/openapi.do" },
  { id: "grooming", label: "동물미용", url: "https://apis.data.go.kr/1741000/pet_grooming/info", meta: "https://www.data.go.kr/data/15154944/openapi.do" },
  { id: "funeral", label: "동물장묘", url: "https://apis.data.go.kr/1741000/animal_cremation/info", meta: "https://www.data.go.kr/data/15155065/openapi.do" },
];

function withKey(endpoint, params = {}) {
  const key = KEY.includes("%") ? KEY : encodeURIComponent(KEY);
  const query = Object.entries(params).map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return `${endpoint}?serviceKey=${key}${query ? `&${query}` : ""}`;
}

function deepItems(payload) {
  const candidates = [payload?.response?.body?.items, payload?.body?.items, payload?.items, payload?.data];
  for (let value of candidates) {
    if (!value) continue;
    if (Array.isArray(value)) return value;
    if (Array.isArray(value.item)) return value.item;
    if (value.item) return [value.item];
  }
  return [];
}

function totalCount(payload) {
  return Number(payload?.response?.body?.totalCount ?? payload?.body?.totalCount ?? payload?.totalCount ?? 0) || 0;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "STARGATE-Pet-Data-Radar/1.0" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) throw new Error("non-json response");
  return JSON.parse(trimmed);
}

const pick = (row, keys, fallback = "") => keys.map(k => row?.[k]).find(v => v !== undefined && v !== null && String(v).trim() !== "") ?? fallback;

function normalize(row, source) {
  const name = String(pick(row, ["BPLC_NM","bplcNm","businessName","title","name"])).trim();
  const road = String(pick(row, ["ROAD_NM_ADDR","roadNmAddr","roadAddress","addr1"])).trim();
  const lot = String(pick(row, ["LOTNO_ADDR","lotnoAddr","siteWhlAddr","address"])).trim();
  const statusCode = String(pick(row, ["SALS_STTS_CD","salsSttsCd","trdStateGbn"])).trim();
  const statusName = String(pick(row, ["SALS_STTS_NM","salsSttsNm","trdStateNm"])).trim();
  const active = statusCode === "01" || /영업|정상|운영/.test(statusName) || (!statusCode && !statusName);
  const address = road || lot;
  const region = (address.match(/^(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|충청북도|충청남도|전북특별자치도|전라남도|경상북도|경상남도|제주특별자치도)/) || [])[1] || "기타";
  return { category: source.label, name, address, region, status: statusName || statusCode || "확인필요", active, permitDate: pick(row,["LCPMT_YMD","lcPmtYmd","apvPermYmd"]), updatedAt: pick(row,["DAT_UPDT_PNT","datUpdtPnt","updateDt"]) };
}

async function collectLicense(source) {
  const rows = [];
  let expected = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const payload = await fetchJson(withKey(source.url, { pageNo: page, numOfRows: PAGE_SIZE, returnType: "json" }));
    const pageRows = deepItems(payload);
    expected = expected || totalCount(payload);
    rows.push(...pageRows.map(r => normalize(r, source)).filter(r => r.name));
    if (!pageRows.length || pageRows.length < PAGE_SIZE || (expected && rows.length >= expected)) break;
    await new Promise(r => setTimeout(r, 1100));
  }
  return { rows, expected };
}

async function collectPetTour() {
  const endpoint = "https://apis.data.go.kr/B551011/KorService2/searchKeyword2";
  const payload = await fetchJson(withKey(endpoint, { MobileOS: "ETC", MobileApp: "STARGATE", _type: "json", keyword: "반려동물", pageNo: 1, numOfRows: 100, arrange: "A" }));
  const items = deepItems(payload);
  return items.map(item => ({ category: "동반여행", name: String(item.title || "").replace(/<[^>]+>/g, ""), address: item.addr1 || "", region: String(item.addr1 || "").split(" ")[0] || "기타", status: "관광공사 등록", active: true, permitDate: "", updatedAt: item.modifiedtime || "", contentId: item.contentid || "" })).filter(x => x.name);
}

function summarize(records) {
  const active = records.filter(r => r.active);
  const byCategory = Object.entries(active.reduce((m,r)=>(m[r.category]=(m[r.category]||0)+1,m),{})).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count);
  const byRegion = Object.entries(active.reduce((m,r)=>(m[r.region]=(m[r.region]||0)+1,m),{})).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count);
  return { total: records.length, active: active.length, byCategory, byRegion };
}

async function loadPrevious() {
  try { return JSON.parse(await readFile(OUT, "utf8")); } catch { return null; }
}

async function main() {
  await mkdir(dirname(OUT), { recursive: true });
  const previous = await loadPrevious();
  const generatedAt = new Date().toISOString();
  if (!KEY) {
    const payload = { generatedAt, mode: "config_required", message: "DATA_GO_KR_API_KEY GitHub Actions secret가 필요합니다.", sources: sources.map(s=>({id:s.id,label:s.label,status:"config_required",meta:s.meta})), summary: previous?.summary || {total:0,active:0,byCategory:[],byRegion:[]}, records: previous?.records || [] };
    await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n");
    return;
  }

  const records = [];
  const sourceStatus = [];
  for (const source of sources) {
    try {
      const result = await collectLicense(source);
      records.push(...result.rows);
      sourceStatus.push({ id: source.id, label: source.label, status: "ok", count: result.rows.length, expected: result.expected, meta: source.meta });
    } catch (error) {
      sourceStatus.push({ id: source.id, label: source.label, status: "error", error: String(error.message || error), meta: source.meta });
    }
  }
  try {
    const tour = await collectPetTour();
    records.push(...tour);
    sourceStatus.push({ id: "pet-tour", label: "반려동물 동반여행", status: "ok", count: tour.length, meta: "https://www.data.go.kr/data/15101578/openapi.do" });
  } catch (error) {
    sourceStatus.push({ id: "pet-tour", label: "반려동물 동반여행", status: "error", error: String(error.message || error), meta: "https://www.data.go.kr/data/15101578/openapi.do" });
  }

  const deduped = [...new Map(records.map(r => [`${r.category}|${r.name}|${r.address}`, r])).values()];
  const payload = { generatedAt, mode: sourceStatus.some(s=>s.status==="ok") ? "live" : "error", sources: sourceStatus, summary: summarize(deduped), records: deduped.slice(0, 12000) };
  await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n");
}

main().catch(async error => {
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ generatedAt:new Date().toISOString(), mode:"error", message:String(error.stack || error), summary:{total:0,active:0,byCategory:[],byRegion:[]}, sources:[], records:[] }, null, 2) + "\n");
  process.exitCode = 1;
});
