#!/usr/bin/env node
// 김프 레이더 데이터 갱신 스크립트
// 금: KRX 금현물 종가 vs COMEX 금 근월물 직전 종가 × 원/달러 (네이버 금융 공개 API)
// 코인: 업비트 원화 시세 vs OKX USDT 시세(실패 시 Kraken), 테더 프리미엄 = 업비트 USDT / 원/달러
// 출력: research/kimchi-premium/data/latest.json (인증키 불필요)

import { writeFile, mkdir } from "node:fs/promises";

const OUT = new URL("../research/kimchi-premium/data/latest.json", import.meta.url);
const OZ = 31.1034768;
const SYMS = ["BTC", "ETH", "XRP", "SOL", "DOGE"];
const NAMES = { BTC: "비트코인", ETH: "이더리움", XRP: "엑스알피", SOL: "솔라나", DOGE: "도지코인" };
const KRAKEN = { BTC: "XBTUSDT", ETH: "ETHUSDT", XRP: "XRPUSDT", SOL: "SOLUSDT", DOGE: "XDGUSDT" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (s) => Number(String(s).replace(/,/g, ""));
const r2 = (x) => Math.round(x * 100) / 100;

async function getJSON(url, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (stargateedu kimchi-premium bot)" } });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return await res.json();
    } catch (e) {
      err = e;
      await sleep(800 * (i + 1));
    }
  }
  throw err;
}

const kstDate = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const kstStamp = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace("T", " ") + " KST";
const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);

// 네이버 금융 일별 시세 (페이지당 60건)
async function naverHistory(kind, code, until) {
  const out = [];
  for (let page = 1; page < 40; page++) {
    const rows = await getJSON(`https://api.stock.naver.com/marketindex/${kind}/${code}/prices?page=${page}&pageSize=60`);
    if (!Array.isArray(rows) || rows.length === 0) break;
    out.push(...rows);
    if (rows.at(-1).localTradedAt.slice(0, 10) < until) break;
    await sleep(200);
  }
  return Object.fromEntries(out.map((x) => [x.localTradedAt.slice(0, 10), num(x.closePrice)]));
}

// 정렬된 날짜 배열에서 d 이전(strict) 또는 d 이하의 마지막 값
function prevValue(map, keys, d, strict) {
  let lo = 0, hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (strict ? keys[mid] < d : keys[mid] <= d) lo = mid + 1; else hi = mid;
  }
  return lo > 0 ? map[keys[lo - 1]] : null;
}

async function overseasNow() {
  try {
    const { data } = await getJSON("https://www.okx.com/api/v5/market/tickers?instType=SPOT");
    const m = {};
    for (const x of data) {
      const [base, quote] = x.instId.split("-");
      if (quote === "USDT" && SYMS.includes(base)) m[base] = num(x.last);
    }
    if (SYMS.every((s) => m[s] > 0)) return { prices: m, source: "OKX" };
  } catch (e) { console.warn("OKX ticker failed:", e.message); }
  const { result } = await getJSON(`https://api.kraken.com/0/public/Ticker?pair=${Object.values(KRAKEN).join(",")}`);
  const m = {};
  for (const s of SYMS) {
    const key = Object.keys(result).find((k) => k === KRAKEN[s] || k.endsWith(KRAKEN[s].slice(-7)) && k.includes(KRAKEN[s].slice(0, 3)));
    if (key) m[s] = num(result[key].c[0]);
  }
  return { prices: m, source: "Kraken" };
}

async function overseasDaily(sym) {
  try {
    const out = [];
    let after = "";
    for (let i = 0; i < 4; i++) {
      const { data } = await getJSON(`https://www.okx.com/api/v5/market/history-candles?instId=${sym}-USDT&bar=1Dutc&limit=100${after ? `&after=${after}` : ""}`);
      if (!data?.length) break;
      out.push(...data);
      after = data.at(-1)[0];
      await sleep(250);
    }
    if (out.length > 300) return Object.fromEntries(out.map((x) => [utcDate(+x[0]), num(x[4])]));
  } catch (e) { console.warn(`OKX candles ${sym} failed:`, e.message); }
  const { result } = await getJSON(`https://api.kraken.com/0/public/OHLC?pair=${KRAKEN[sym]}&interval=1440`);
  const key = Object.keys(result).find((k) => k !== "last");
  return Object.fromEntries(result[key].map((x) => [utcDate(x[0] * 1000), num(x[4])]));
}

async function upbitDaily(market) {
  const out = [];
  let to = "";
  for (let i = 0; i < 2; i++) {
    const rows = await getJSON(`https://api.upbit.com/v1/candles/days?market=${market}&count=200${to ? `&to=${encodeURIComponent(to)}` : ""}`);
    if (!rows.length) break;
    out.push(...rows);
    to = rows.at(-1).candle_date_time_utc + "Z";
    await sleep(300);
  }
  return Object.fromEntries(out.map((x) => [x.candle_date_time_kst.slice(0, 10), x.trade_price]));
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

async function main() {
  const now = new Date();
  const today = kstDate(now);
  const threeYearsAgo = kstDate(new Date(now.getTime() - 3 * 365.25 * 864e5));

  // 금·은·환율
  const [krx, gc, si, fx] = [
    await naverHistory("metals", "M04020000", threeYearsAgo),
    await naverHistory("metals", "GCcv1", threeYearsAgo),
    await naverHistory("metals", "SIcv1", threeYearsAgo),
    await naverHistory("exchange", "FX_USDKRW", threeYearsAgo),
  ];
  const gcKeys = Object.keys(gc).sort(), fxKeys = Object.keys(fx).sort(), siKeys = Object.keys(si).sort();

  const gold = [];
  for (const d of Object.keys(krx).sort()) {
    if (d < threeYearsAgo) continue;
    const g = prevValue(gc, gcKeys, d, true), r = prevValue(fx, fxKeys, d, false);
    if (!g || !r) continue;
    const intl = (g * r) / OZ;
    gold.push([d, Math.round(krx[d]), Math.round(intl), r2((krx[d] / intl - 1) * 100)]);
  }
  if (gold.length < 200) throw new Error(`gold series too short: ${gold.length}`);

  const stats = {};
  for (const y of [...new Set(gold.map((r) => r[0].slice(0, 4)))].slice(-3)) {
    const rows = gold.filter((r) => r[0].startsWith(y));
    stats[y] = { max: rows.reduce((a, b) => (b[3] > a[3] ? b : a)), mean: r2(mean(rows.map((r) => r[3]))) };
  }

  // 코인 현재가
  const fxNow = fx[fxKeys.at(-1)];
  const tickers = await getJSON(`https://api.upbit.com/v1/ticker?markets=${[...SYMS, "USDT"].map((s) => "KRW-" + s).join(",")}`);
  const upNow = Object.fromEntries(tickers.map((x) => [x.market.slice(4), x.trade_price]));
  const ov = await overseasNow();
  const usdt = upNow.USDT;
  const coins = SYMS.filter((s) => upNow[s] && ov.prices[s]).map((s) => ({
    sym: s, name: NAMES[s], krw: upNow[s], usdt: ov.prices[s],
    fx: r2((upNow[s] / (ov.prices[s] * fxNow) - 1) * 100),
    tether: r2((upNow[s] / (ov.prices[s] * usdt) - 1) * 100),
  }));
  if (!coins.length || coins[0].sym !== "BTC") throw new Error("BTC quote missing");

  // 코인 1년 일별 (업비트 KST 09:00 마감 = OKX/Kraken UTC 일봉 마감)
  const upBTC = await upbitDaily("KRW-BTC");
  const upUSDT = await upbitDaily("KRW-USDT");
  const ovBTC = await overseasDaily("BTC");
  const yearAgo = kstDate(new Date(now.getTime() - 365 * 864e5));
  const coinHist = [];
  for (const d of Object.keys(upBTC).sort()) {
    const r = prevValue(fx, fxKeys, d, false);
    if (d < yearAgo || !ovBTC[d] || !upUSDT[d] || !r) continue;
    coinHist.push([d, r2((upBTC[d] / (ovBTC[d] * r) - 1) * 100), r2((upUSDT[d] / r - 1) * 100), r2((upBTC[d] / (ovBTC[d] * upUSDT[d]) - 1) * 100)]);
  }

  const silverDate = siKeys.at(-1), silverUsd = si[silverDate];
  const data = {
    asof: kstStamp(now),
    generatedAt: now.toISOString(),
    fx: fxNow, fxDate: fxKeys.at(-1),
    usdt, usdtPrem: r2((usdt / fxNow - 1) * 100),
    overseasSource: ov.source,
    coins, gold, goldNow: gold.at(-1), coinHist,
    silver: { usdOz: silverUsd, date: silverDate, krwG: Math.round((silverUsd * fxNow) / OZ), krwDon: Math.round(((silverUsd * fxNow) / OZ) * 3.75) },
    stats,
  };

  await mkdir(new URL(".", OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(data) + "\n");
  console.log(`김프 레이더 갱신 ${data.asof} · 금 ${gold.length}일 · 코인 ${coinHist.length}일 · 금 ${data.goldNow[3]}% · BTC ${coins[0].fx}% · USDT ${data.usdtPrem}% (${ov.source}) · today ${today}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
