import { fetchExchangeRates } from "../lib/codef.js";

const ALLOWED_ORIGINS = new Set([
  "https://www.stargateedu.co.kr",
  "https://stargateedu.co.kr"
]);

function cors(request, response) {
  const origin = request.headers.origin;
  if (ALLOWED_ORIGINS.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(request, response) {
  cors(request, response);
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET, OPTIONS");
    return response.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }
  try {
    const result = await fetchExchangeRates();
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
    return response.status(200).json({ ok: true, provider: "CODEF", environment: result.environment, fetchedAt: new Date().toISOString(), rates: result.rates });
  } catch (error) {
    const setupRequired = error?.code === "CONFIG_REQUIRED";
    response.setHeader("Cache-Control", "no-store");
    return response.status(setupRequired ? 503 : 502).json({
      ok: false,
      provider: "CODEF",
      error: setupRequired ? "CONFIG_REQUIRED" : "UPSTREAM_UNAVAILABLE",
      code: setupRequired ? undefined : error?.code,
      message: setupRequired ? "CODEF API 환경변수 설정이 필요합니다." : "CODEF 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요."
    });
  }
}
