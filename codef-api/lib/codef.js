const HOSTS = Object.freeze({
  production: "https://api.codef.io",
  development: "https://development.codef.io",
  sandbox: "https://sandbox.codef.io"
});

const EXCHANGE_PATH = "/v1/kr/bank/a/exchangerate/check";
const SUCCESS_CODE = "CF-00000";
let tokenCache = { value: "", expiresAt: 0 };

export function decodeCodefResponse(text) {
  if (!text) return {};
  try {
    return JSON.parse(decodeURIComponent(text.replace(/\+/g, " ")));
  } catch {
    return JSON.parse(text);
  }
}

export function normalizeRates(payload) {
  const data = payload?.data;
  const rows = Array.isArray(data)
    ? data
    : data?.resList ?? data?.list ?? data?.dataList ?? (data ? [data] : []);

  return rows.map((row) => ({
    currency: row?.resCurrencyCode ?? row?.resCurrency ?? row?.currencyCode ?? row?.curUnit ?? row?.resCurrencyName ?? "",
    rate: row?.resExchangeRate ?? row?.resBasicRate ?? row?.exchangeRate ?? row?.dealBasR ?? "",
    commissionRate: row?.resCommissionRate ?? row?.commissionRate ?? "",
    cashBuyingRate: row?.resCashBuyingRate ?? row?.cashBuyingRate ?? "",
    cashSellingRate: row?.resCashSellingRate ?? row?.cashSellingRate ?? "",
    remittanceSendingRate: row?.resRemittanceSendingRate ?? row?.remittanceSendingRate ?? "",
    remittanceReceivingRate: row?.resRemittanceReceivingRate ?? row?.remittanceReceivingRate ?? "",
    announcedAt: row?.resDateTime ?? row?.resDate ?? row?.announcedAt ?? ""
  })).filter((row) => row.currency || row.rate);
}

function environment() {
  const value = (process.env.CODEF_ENVIRONMENT || "production").toLowerCase();
  if (!HOSTS[value]) throw new Error("Unsupported CODEF_ENVIRONMENT");
  return value;
}

function credentials() {
  const clientId = process.env.CODEF_CLIENT_ID;
  const clientSecret = process.env.CODEF_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    const error = new Error("CODEF credentials are not configured");
    error.code = "CONFIG_REQUIRED";
    throw error;
  }
  return { clientId, clientSecret };
}

function exchangeBody() {
  if (process.env.CODEF_EXCHANGE_BODY) {
    const body = JSON.parse(process.env.CODEF_EXCHANGE_BODY);
    if (!body || Array.isArray(body) || typeof body !== "object") throw new Error("CODEF_EXCHANGE_BODY must be a JSON object");
    return body;
  }
  const organization = process.env.CODEF_EXCHANGE_ORGANIZATION;
  if (!organization) {
    const error = new Error("CODEF exchange organization is not configured");
    error.code = "CONFIG_REQUIRED";
    throw error;
  }
  return { organization };
}

async function accessToken() {
  const now = Date.now();
  if (tokenCache.value && tokenCache.expiresAt > now + 60_000) return tokenCache.value;

  const { clientId, clientSecret } = credentials();
  const response = await fetch("https://oauth.codef.io/oauth/token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
    },
    body: "grant_type=client_credentials&scope=read",
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    const error = new Error(`CODEF OAuth failed (${response.status})`);
    error.code = "UPSTREAM_AUTH";
    throw error;
  }
  const body = await response.json();
  if (!body.access_token) {
    const error = new Error("CODEF OAuth response has no access token");
    error.code = "UPSTREAM_AUTH";
    throw error;
  }
  const expiresIn = Math.max(60, Number(body.expires_in) || 3600);
  tokenCache = { value: body.access_token, expiresAt: now + expiresIn * 1000 };
  return tokenCache.value;
}

export async function fetchExchangeRates() {
  const mode = environment();
  const token = await accessToken();
  const response = await fetch(`${HOSTS[mode]}${EXCHANGE_PATH}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: encodeURIComponent(JSON.stringify(exchangeBody())),
    signal: AbortSignal.timeout(20_000)
  });
  const payload = decodeCodefResponse(await response.text());
  if (!response.ok) {
    const error = new Error(`CODEF exchange request failed (${response.status})`);
    error.code = "UPSTREAM_HTTP";
    throw error;
  }
  const resultCode = payload?.result?.code;
  if (resultCode !== SUCCESS_CODE) {
    const error = new Error(payload?.result?.message || "CODEF returned an error");
    error.code = resultCode || "UPSTREAM_CODEF";
    throw error;
  }
  return { environment: mode, resultCode, rates: normalizeRates(payload) };
}
