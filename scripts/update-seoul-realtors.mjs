import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const TARGET_DISTRICTS = ["강남구", "서초구", "송파구"];
const TARGET_COUNT = Number(process.env.REALTOR_TARGET_COUNT || 3000);
const OUTPUT_PATH = resolve("research/seoul-realtors/data/latest.json");
const SEOUL_KEY = process.env.SEOUL_OPEN_DATA_KEY || "";
const KAKAO_KEY = process.env.KAKAO_REST_API_KEY || "";
const JUSO_KEY = process.env.JUSO_API_KEY || "";
const JUSO_SEARCH_KEY = process.env.JUSO_SEARCH_API_KEY || JUSO_KEY;
const JUSO_COORD_KEY = process.env.JUSO_COORD_API_KEY || JUSO_KEY;
const GEOCODER = process.env.GEOCODER || (KAKAO_KEY ? "kakao" : "source-only");

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function hasCoordinates(row) {
  const latitude = row?.latitude;
  const longitude = row?.longitude;
  return latitude !== null && latitude !== undefined && latitude !== ""
    && longitude !== null && longitude !== undefined && longitude !== ""
    && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
}

function districtFromAddress(address = "") {
  return TARGET_DISTRICTS.find((district) => address.includes(district)) || "";
}

function normalizeSeoulRow(row) {
  const address = String(row.ADDR || "").trim();
  return {
    id: String(row.SYS_REG_NO || row.REST_BRKR_INFO || "").trim(),
    name: String(row.BZMN_CONM || "").trim(),
    district: String(row.CGG_CD || districtFromAddress(address)).trim(),
    dong: String(row.LGL_DONG_NM || "").trim(),
    address,
    registrationNo: String(row.REST_BRKR_INFO || "").trim(),
    phone: String(row.TELNO || "").trim(),
    status: String(row.STTS_SE || "").trim(),
    latitude: null,
    longitude: null,
  };
}

function normalizeStandardRow(row) {
  const address = String(row.LCTN_ROAD_NM_ADDR || row.LCTN_LOTNO_ADDR || "").trim();
  const latitude = Number(row.LATITUDE);
  const longitude = Number(row.LONGITUDE);
  return {
    id: String(row.ESTBL_REG_NO || `${row.MED_OFFICE_NM}-${address}`).trim(),
    name: String(row.MED_OFFICE_NM || "").trim(),
    district: districtFromAddress(address),
    dong: (address.match(/서울특별시\s+\S+구\s+([^\s,]+)/) || [])[1] || "",
    address,
    registrationNo: String(row.ESTBL_REG_NO || "").trim(),
    phone: String(row.TELNO || "").trim(),
    status: "공개표준데이터",
    latitude: Number.isFinite(latitude) && latitude > 33 && latitude < 39 ? latitude : null,
    longitude: Number.isFinite(longitude) && longitude > 124 && longitude < 132 ? longitude : null,
  };
}

async function fetchJson(url, options = {}, retries = 3) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastError;
}

async function fetchSeoulRows() {
  const first = await fetchJson(`http://openapi.seoul.go.kr:8088/${SEOUL_KEY}/json/landBizInfo/1/1000/`);
  const root = first.landBizInfo;
  if (!root || !Array.isArray(root.row)) throw new Error("서울 열린데이터 응답을 확인할 수 없습니다.");
  const total = Number(root.list_total_count || root.row.length);
  const rows = [...root.row];
  for (let start = 1001; start <= total; start += 1000) {
    const end = Math.min(start + 999, total);
    const payload = await fetchJson(`http://openapi.seoul.go.kr:8088/${SEOUL_KEY}/json/landBizInfo/${start}/${end}/`);
    rows.push(...(payload.landBizInfo?.row || []));
  }
  return rows.map(normalizeSeoulRow).filter((row) => TARGET_DISTRICTS.includes(row.district) && row.status === "영업중");
}

async function fetchStandardRows() {
  const columns = [
    "MED_OFFICE_NM", "ESTBL_REG_NO", "OPBIZ_LREA_CLSC_SE", "LCTN_ROAD_NM_ADDR",
    "LCTN_LOTNO_ADDR", "TELNO", "LATITUDE", "LONGITUDE", "CRTR_YMD",
  ];
  const rows = [];
  for (let page = 1; page <= 20; page += 1) {
    const url = new URL("https://www.data.go.kr/download/standard.json");
    url.searchParams.set("publicDataPk", "15107745");
    columns.forEach((column) => url.searchParams.append("colNmList", column));
    url.searchParams.set("totalCount", "50000");
    url.searchParams.set("svcTableNm", "tn_pubr_public_med_office_svc");
    url.searchParams.set("perPage", "10000");
    url.searchParams.set("page", String(page));
    const pageRows = await fetchJson(url);
    rows.push(...pageRows);
    if (pageRows.length < 10000) break;
  }
  return rows.map(normalizeStandardRow).filter((row) => TARGET_DISTRICTS.includes(row.district));
}

function selectBalanced(rows) {
  const unique = new Map();
  rows.forEach((row) => {
    if (row.id && row.name && row.address && !unique.has(row.id)) unique.set(row.id, row);
  });
  const buckets = Object.fromEntries(TARGET_DISTRICTS.map((district) => [district, []]));
  [...unique.values()].forEach((row) => buckets[row.district]?.push(row));
  TARGET_DISTRICTS.forEach((district) => buckets[district].sort((a, b) => a.name.localeCompare(b.name, "ko")));

  const selected = [];
  const quota = Math.floor(TARGET_COUNT / TARGET_DISTRICTS.length);
  TARGET_DISTRICTS.forEach((district) => selected.push(...buckets[district].splice(0, quota)));
  const remainder = TARGET_DISTRICTS.flatMap((district) => buckets[district]);
  selected.push(...remainder.slice(0, Math.max(0, TARGET_COUNT - selected.length)));
  return selected.slice(0, TARGET_COUNT);
}

async function retainKnownCoordinates(rows) {
  try {
    const previous = JSON.parse(await readFile(OUTPUT_PATH, "utf8"));
    const byId = new Map((previous.records || []).filter(hasCoordinates).map((row) => [row.id, row]));
    const byAddress = new Map((previous.records || []).filter(hasCoordinates).map((row) => [row.address, row]));
    for (const row of rows) {
      if (hasCoordinates(row)) continue;
      const known = byId.get(row.id) || byAddress.get(row.address);
      if (known) {
        row.latitude = Number(known.latitude);
        row.longitude = Number(known.longitude);
      }
    }
  } catch (error) {
    console.warn(`기존 좌표 유지 생략: ${error.message}`);
  }
  return rows;
}

async function geocodeAddress(address) {
  const url = new URL("https://dapi.kakao.com/v2/local/search/address.json");
  url.searchParams.set("query", address);
  const payload = await fetchJson(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  const result = payload.documents?.[0];
  return result ? { latitude: Number(result.y), longitude: Number(result.x) } : null;
}

function baseRoadAddress(address) {
  const match = address.match(/^(서울특별시\s+\S+구\s+.+?\s+\d+(?:-\d+)?)(?:\s|,|$)/);
  return match ? match[1] : address.replace(/\([^)]*\)/g, "").split(",")[0].trim();
}

async function geocodeNominatim(address, district) {
  const query = baseRoadAddress(address);
  const joinKey = addressJoinKey(address);
  if (!joinKey) return null;
  const [, requestedStreet, requestedNumber] = joinKey.split("|");
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "3");
  url.searchParams.set("countrycodes", "kr");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "ko");
  url.searchParams.set("q", query);
  const payload = await fetchJson(url, {
    headers: {
      "User-Agent": "STARGATE-Seoul-Realtor-Research/1.0 (https://www.stargateedu.co.kr/stargateedu/research/seoul-realtors/)",
      Referer: "https://www.stargateedu.co.kr/stargateedu/research/seoul-realtors/",
    },
  }, 2);
  const result = payload.find((item) => {
    const latitude = Number(item.lat);
    const longitude = Number(item.lon);
    const inSeoul = latitude >= 37.40 && latitude <= 37.72 && longitude >= 126.75 && longitude <= 127.25;
    const namedDistrict = TARGET_DISTRICTS.find((name) => String(item.display_name || "").includes(name));
    const candidateNumber = String(item.address?.house_number || "").trim();
    const candidateStreet = String(item.address?.road || item.address?.pedestrian || item.address?.residential || "")
      .normalize("NFKC").replace(/\s+/g, "");
    const exactAddress = candidateNumber === requestedNumber
      && (!candidateStreet || candidateStreet === requestedStreet);
    return inSeoul && exactAddress && (!namedDistrict || namedDistrict === district);
  });
  return result ? { latitude: Number(result.lat), longitude: Number(result.lon) } : null;
}

function addressJoinKey(address) {
  const base = baseRoadAddress(address);
  const match = base.match(/^서울특별시\s+(강남구|서초구|송파구)\s+(.+?)\s+(\d+(?:-\d+)?)$/);
  if (!match) return "";
  return `${match[1]}|${match[2].normalize("NFKC").replace(/\s+/g, "")}|${match[3]}`;
}

function assertJusoResponse(payload, operation) {
  const results = payload?.results;
  const errorCode = String(results?.common?.errorCode ?? "");
  if (errorCode !== "0") {
    const message = results?.common?.errorMessage || "응답 형식 오류";
    throw new Error(`JUSO API ${operation} 실패: ${errorCode || "unknown"} ${message}`);
  }
  return results.juso || [];
}

async function geocodeJuso(address, district) {
  const joinKey = addressJoinKey(address);
  if (!joinKey) return null;

  const searchUrl = new URL("https://business.juso.go.kr/addrlink/addrLinkApi.do");
  searchUrl.searchParams.set("confmKey", JUSO_SEARCH_KEY);
  searchUrl.searchParams.set("currentPage", "1");
  searchUrl.searchParams.set("countPerPage", "10");
  searchUrl.searchParams.set("keyword", baseRoadAddress(address));
  searchUrl.searchParams.set("resultType", "json");
  searchUrl.searchParams.set("hstryYn", "N");
  searchUrl.searchParams.set("firstSort", "road");
  const searchPayload = await fetchJson(searchUrl, {}, 2);
  const candidate = assertJusoResponse(searchPayload, "주소 검색").find((item) => {
    const candidateAddress = item.roadAddr || item.roadAddrPart1 || "";
    return item.siNm === "서울특별시"
      && item.sggNm === district
      && addressJoinKey(candidateAddress) === joinKey;
  });
  if (!candidate) return null;

  const coordUrl = new URL("https://business.juso.go.kr/addrlink/addrCoordApi.do");
  coordUrl.searchParams.set("confmKey", JUSO_COORD_KEY);
  coordUrl.searchParams.set("admCd", candidate.admCd);
  coordUrl.searchParams.set("rnMgtSn", candidate.rnMgtSn);
  coordUrl.searchParams.set("udrtYn", candidate.udrtYn || "0");
  coordUrl.searchParams.set("buldMnnm", candidate.buldMnnm);
  coordUrl.searchParams.set("buldSlno", candidate.buldSlno || "0");
  coordUrl.searchParams.set("resultType", "json");
  const coordPayload = await fetchJson(coordUrl, {}, 2);
  const coordinate = assertJusoResponse(coordPayload, "좌표 검색")[0];
  if (!coordinate) return null;

  const entX = Number(coordinate.entX);
  const entY = Number(coordinate.entY);
  if (!Number.isFinite(entX) || !Number.isFinite(entY)) return null;
  const { default: proj4 } = await import("proj4");
  const epsg5179 = "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs";
  const [longitude, latitude] = proj4(epsg5179, "EPSG:4326", [entX, entY]);
  const inSeoul = latitude >= 37.40 && latitude <= 37.72 && longitude >= 126.75 && longitude <= 127.25;
  return inSeoul ? { latitude, longitude } : null;
}

async function fetchOverpassAddressIndex() {
  const index = new Map();
  for (const district of TARGET_DISTRICTS) {
    const query = `[out:json][timeout:180];area["boundary"="administrative"]["name"="${district}"]->.a;nwr["addr:street"]["addr:housenumber"](area.a);out center;`;
    const url = new URL("https://overpass-api.de/api/interpreter");
    url.searchParams.set("data", query);
    const payload = await fetchJson(url, {
      headers: {
        "User-Agent": "STARGATE-Seoul-Realtor-Research/1.0 (https://www.stargateedu.co.kr/stargateedu/research/seoul-realtors/)",
      },
    }, 2);
    for (const element of payload.elements || []) {
      const street = String(element.tags?.["addr:street"] || "").normalize("NFKC").replace(/\s+/g, "");
      const number = String(element.tags?.["addr:housenumber"] || "").trim();
      const latitude = Number(element.lat ?? element.center?.lat);
      const longitude = Number(element.lon ?? element.center?.lon);
      if (!street || !number || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
      const key = `${district}|${street}|${number}`;
      if (!index.has(key)) index.set(key, { latitude, longitude });
    }
    console.log(`OSM 주소점 수집: ${district} · 누적 ${index.size}건`);
  }
  return index;
}

async function geocodeMissing(rows) {
  if (GEOCODER === "source-only") return rows;
  if (GEOCODER === "overpass") {
    const index = await fetchOverpassAddressIndex();
    for (const row of rows) {
      if (hasCoordinates(row)) continue;
      const point = index.get(addressJoinKey(row.address));
      if (point) Object.assign(row, point);
    }
    return rows;
  }
  if (GEOCODER === "kakao" && !KAKAO_KEY) throw new Error("KAKAO_REST_API_KEY가 필요합니다.");
  if (GEOCODER === "juso" && (!JUSO_SEARCH_KEY || !JUSO_COORD_KEY)) {
    throw new Error("JUSO_API_KEY 또는 JUSO_SEARCH_API_KEY/JUSO_COORD_API_KEY가 필요합니다.");
  }
  const cachePath = resolve("research/seoul-realtors/data/geocode-cache.json");
  let cache = {};
  try { cache = JSON.parse(await readFile(cachePath, "utf8")); } catch {}

  const queue = rows.filter((row) => !hasCoordinates(row));
  let cursor = 0;
  let processed = 0;
  async function worker() {
    while (cursor < queue.length) {
      const row = queue[cursor++];
      const cacheKey = GEOCODER === "nominatim"
        ? `nominatim:${baseRoadAddress(row.address)}`
        : GEOCODER === "juso"
          ? `juso:${baseRoadAddress(row.address)}`
          : `kakao:${row.address}`;
      const cached = Object.prototype.hasOwnProperty.call(cache, cacheKey) ? cache[cacheKey] : undefined;
      let requested = false;
      try {
        const point = cached !== undefined
          ? cached
          : GEOCODER === "nominatim"
            ? (requested = true, await geocodeNominatim(row.address, row.district))
            : GEOCODER === "juso"
              ? (requested = true, await geocodeJuso(row.address, row.district))
              : (requested = true, await geocodeAddress(row.address));
        if (point) Object.assign(row, point);
        cache[cacheKey] = point;
      } catch (error) {
        if (GEOCODER === "juso" && error.message.startsWith("JUSO API")) throw error;
        console.warn(`지오코딩 실패: ${row.address} (${error.message})`);
      }
      processed += 1;
      if (processed % 25 === 0) {
        await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
        console.log(`지오코딩 진행: ${processed}/${queue.length}`);
      }
      if (requested) await sleep(GEOCODER === "nominatim" ? 1100 : GEOCODER === "juso" ? 180 : 120);
    }
  }
  const workerCount = GEOCODER === "nominatim" ? 1 : GEOCODER === "juso" ? 2 : 4;
  await Promise.all(Array.from({ length: workerCount }, worker));
  await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  return rows;
}

const source = SEOUL_KEY ? "서울 열린데이터광장 landBizInfo" : "공공데이터포털 전국공인중개사사무소표준데이터";
const sourceUrl = SEOUL_KEY
  ? "https://data.seoul.go.kr/dataList/OA-15550/A/1/datasetView.do"
  : "https://www.data.go.kr/data/15107745/openapi.do";
const rawRows = SEOUL_KEY ? await fetchSeoulRows() : await fetchStandardRows();
const selected = await geocodeMissing(await retainKnownCoordinates(selectBalanced(rawRows)));
const records = selected.map(({ latitude, longitude, ...row }) => ({ ...row, latitude, longitude }));
const mappedRecords = records.filter(hasCoordinates).length;
const districtCounts = Object.fromEntries(TARGET_DISTRICTS.map((district) => [district, records.filter((row) => row.district === district).length]));
const payload = {
  meta: {
    title: "서울 강남권 공인중개사사무소 연구 데이터",
    generatedAt: new Date().toISOString(),
    targetCount: TARGET_COUNT,
    totalRecords: records.length,
    mappedRecords,
    pendingGeocode: records.length - mappedRecords,
    districts: TARGET_DISTRICTS,
    districtCounts,
    source,
    sourceUrl,
    geocoder: GEOCODER === "kakao" ? "Kakao Local API" : GEOCODER === "juso" ? "행정안전부 도로명주소 좌표 API · 정확주소 보완" : GEOCODER === "nominatim" ? "OpenStreetMap 주소점 · Nominatim 정밀 보완" : GEOCODER === "overpass" ? "OpenStreetMap 주소점 · Overpass 일괄 결합" : "원천 좌표 · 기존 검증 좌표 유지",
    isPilot: true,
  },
  records,
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(payload)}\n`, "utf8");
console.log(`저장 완료: ${OUTPUT_PATH} (${records.length}건, 지도 ${mappedRecords}건)`);
