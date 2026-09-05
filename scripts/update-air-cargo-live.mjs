import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const OUT = resolve("strategy/air-cargo-live/data/latest.json");
const KEY = (process.env.DATA_GO_KR_API_KEY || "").trim();
const ENDPOINT = "https://apis.data.go.kr/B551177/StatusOfCargoFlights/getCargoArrivals";
const META = "https://www.data.go.kr/data/15095068/openapi.do";

function withKey(params) {
  const key = KEY.includes("%") ? KEY : encodeURIComponent(KEY);
  const query = new URLSearchParams(params);
  return `${ENDPOINT}?serviceKey=${key}&${query}`;
}

function findItems(payload) {
  const candidates = [
    payload?.response?.body?.items,
    payload?.response?.body?.items?.item,
    payload?.body?.items,
    payload?.body?.items?.item,
    payload?.items,
  ];
  for (const value of candidates) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.item)) return value.item;
    if (value?.item) return [value.item];
  }
  return [];
}

function delayMinutes(scheduled, estimated) {
  if (!/^\d{4}$/.test(scheduled) || !/^\d{4}$/.test(estimated)) return null;
  const minutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(2));
  let difference = minutes(estimated) - minutes(scheduled);
  if (difference < -720) difference += 1440;
  if (difference > 720) difference -= 1440;
  return difference;
}

function normalize(item) {
  const scheduled = String(item.scheduleDateTime || item.scheduleDatetime || "");
  const estimated = String(item.estimatedDateTime || item.estimatedDatetime || "");
  const flightId = String(item.flightId || item.flight_id || "");
  return {
    airline: String(item.airline || ""),
    airlineCode: flightId.match(/^[A-Z0-9]{2,3}/i)?.[0]?.toUpperCase() || "",
    flightId,
    scheduled,
    estimated,
    delayMinutes: delayMinutes(scheduled, estimated),
    origin: String(item.airport || ""),
    originCode: String(item.airportCode || ""),
    gate: String(item.gatenumber || item.gateNumber || ""),
    terminal: String(item.terminalId || ""),
    status: String(item.remark || "예정"),
  };
}

function summarize(flights) {
  const delays = flights.map((flight) => flight.delayMinutes).filter((value) => Number.isFinite(value) && value > 0);
  return {
    total: flights.length,
    arrived: flights.filter((flight) => /도착|착륙/.test(flight.status)).length,
    delayed: flights.filter((flight) => /지연/.test(flight.status) || (flight.delayMinutes || 0) >= 20).length,
    cancelled: flights.filter((flight) => /결항|회항/.test(flight.status)).length,
    airlines: new Set(flights.map((flight) => flight.airline).filter(Boolean)).size,
    origins: new Set(flights.map((flight) => flight.originCode || flight.origin).filter(Boolean)).size,
    averageDelayMinutes: delays.length ? Math.round(delays.reduce((sum, value) => sum + value, 0) / delays.length) : 0,
  };
}

async function previous() {
  try { return JSON.parse(await readFile(OUT, "utf8")); } catch { return null; }
}

async function main() {
  await mkdir(dirname(OUT), { recursive: true });
  const old = await previous();
  if (!KEY) {
    if (old?.mode === "live") {
      console.log("API key unavailable; preserving last successful data.");
      return;
    }
    console.log("DATA_GO_KR_API_KEY secret is required.");
    return;
  }
  const response = await fetch(withKey({ from_time: "0000", to_time: "2400", lang: "K", type: "json" }), {
    headers: { accept: "application/json", "user-agent": "STARGATE-Air-Cargo-Live/1.0" },
    signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!raw.trim().startsWith("{") && !raw.trim().startsWith("[")) throw new Error("Non-JSON response");
  const data = JSON.parse(raw);
  const code = String(data?.response?.header?.resultCode ?? data?.header?.resultCode ?? "00");
  if (code !== "00") throw new Error(`OpenAPI resultCode ${code}`);
  const flights = findItems(data).map(normalize).sort((a, b) => (a.scheduled || "9999").localeCompare(b.scheduled || "9999"));
  if (old?.mode === "live" && JSON.stringify(old.flights) === JSON.stringify(flights)) {
    console.log("No flight changes.");
    return;
  }
  const output = {
    generatedAt: new Date().toISOString(),
    mode: "live",
    message: "",
    source: { name: "인천국제공항공사_화물편 운항현황", url: META, intervalMinutes: 10 },
    summary: summarize(flights),
    flights,
  };
  await writeFile(OUT, JSON.stringify(output, null, 2) + "\n");
  console.log(`Updated ${flights.length} cargo flights.`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
