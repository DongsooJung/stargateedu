import crypto from 'node:crypto';
import http from 'node:http';
import {GoogleGenAI} from '@google/genai';
import {BigQuery} from '@google-cloud/bigquery';

const PORT = Number.parseInt(process.env.PORT || '8080', 10);
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || '';
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'global';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const PLACES_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
const STARGATE_API_TOKEN = process.env.STARGATE_API_TOKEN || '';
const BIGQUERY_PUBLIC_VIEWS = new Set(
  (process.env.BIGQUERY_PUBLIC_VIEWS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const BIGQUERY_MAX_BYTES_BILLED = process.env.BIGQUERY_MAX_BYTES_BILLED || '100000000';
const ALLOWED_ORIGINS = new Set(
  (process.env.CORS_ORIGINS || 'https://www.stargateedu.co.kr,https://stargateedu.co.kr')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const RATE_LIMIT_PER_MINUTE = Math.max(
  1,
  Number.parseInt(process.env.RATE_LIMIT_PER_MINUTE || '30', 10) || 30,
);

const ai = PROJECT_ID
  ? new GoogleGenAI({vertexai: true, project: PROJECT_ID, location: LOCATION})
  : null;
const bigquery = PROJECT_ID ? new BigQuery({projectId: PROJECT_ID}) : null;
const rateBuckets = new Map();

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!ALLOWED_ORIGINS.has(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Stargate-Api-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  return true;
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function withinRateLimit(req) {
  const key = clientIp(req);
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || now - current.startedAt >= 60_000) {
    rateBuckets.set(key, {startedAt: now, count: 1});
    return true;
  }
  current.count += 1;
  if (rateBuckets.size > 5000) {
    for (const [ip, bucket] of rateBuckets) {
      if (now - bucket.startedAt >= 60_000) rateBuckets.delete(ip);
    }
  }
  return current.count <= RATE_LIMIT_PER_MINUTE;
}

function validApiToken(req) {
  if (!STARGATE_API_TOKEN) return {ok: false, status: 503, error: 'api_token_not_configured'};
  const supplied = req.headers['x-stargate-api-key'];
  if (typeof supplied !== 'string' || !supplied) {
    return {ok: false, status: 401, error: 'api_token_required'};
  }
  const actualBuffer = Buffer.from(STARGATE_API_TOKEN);
  const suppliedBuffer = Buffer.from(supplied);
  if (actualBuffer.length !== suppliedBuffer.length) {
    return {ok: false, status: 401, error: 'invalid_api_token'};
  }
  if (!crypto.timingSafeEqual(actualBuffer, suppliedBuffer)) {
    return {ok: false, status: 401, error: 'invalid_api_token'};
  }
  return {ok: true};
}

async function readJson(req, maxBytes = 200_000) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > maxBytes) {
      const error = new Error('request_too_large');
      error.statusCode = 413;
      throw error;
    }
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('invalid_json');
    error.statusCode = 400;
    throw error;
  }
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function serviceStatus() {
  return {
    ok: true,
    service: process.env.K_SERVICE || 'local',
    revision: process.env.K_REVISION || null,
    configured: {
      apiToken: Boolean(STARGATE_API_TOKEN),
      vertexAi: Boolean(PROJECT_ID),
      places: Boolean(PLACES_API_KEY),
      bigQuery: Boolean(PROJECT_ID && BIGQUERY_PUBLIC_VIEWS.size),
    },
    model: GEMINI_MODEL,
    location: LOCATION,
    publicBigQueryViews: BIGQUERY_PUBLIC_VIEWS.size,
    billablePostEndpointsProtected: true,
  };
}

async function handleAiAnalyze(req, res) {
  if (!ai) return json(res, 503, {ok: false, error: 'vertex_ai_not_configured'});
  const body = await readJson(req);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
  if (!text) return json(res, 400, {ok: false, error: 'text_required'});
  if (text.length > 20_000 || instruction.length > 2_000) {
    return json(res, 413, {ok: false, error: 'input_too_large'});
  }

  const prompt = [
    instruction || 'Analyze the supplied research material. Return concise Korean findings, key signals, caveats, and next actions.',
    '',
    'Research input:',
    text,
  ].join('\n');

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {temperature: 0.2},
  });

  return json(res, 200, {
    ok: true,
    model: GEMINI_MODEL,
    text: response.text || '',
  });
}

async function handlePlacesSearch(req, res) {
  if (!PLACES_API_KEY) return json(res, 503, {ok: false, error: 'places_not_configured'});
  const body = await readJson(req);
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) return json(res, 400, {ok: false, error: 'query_required'});
  if (query.length > 200) return json(res, 413, {ok: false, error: 'query_too_large'});

  const payload = {
    textQuery: query,
    pageSize: clampInteger(body.pageSize, 1, 20, 10),
    languageCode: 'ko',
    regionCode: 'KR',
  };

  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    payload.locationBias = {
      circle: {
        center: {latitude, longitude},
        radius: Math.min(50_000, Math.max(100, Number(body.radius) || 5_000)),
      },
    };
  }

  if (typeof body.pageToken === 'string' && body.pageToken.trim()) {
    payload.pageToken = body.pageToken.trim();
  }

  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': PLACES_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,nextPageToken',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return json(res, response.status, {
      ok: false,
      error: 'places_request_failed',
      details: data?.error?.message || null,
    });
  }

  return json(res, 200, {
    ok: true,
    places: (data.places || []).map((place) => ({
      id: place.id,
      name: place.displayName?.text || '',
      address: place.formattedAddress || '',
      latitude: place.location?.latitude ?? null,
      longitude: place.location?.longitude ?? null,
      primaryType: place.primaryType || null,
    })),
    nextPageToken: data.nextPageToken || null,
  });
}

async function handleBigQueryView(req, res) {
  if (!bigquery || !BIGQUERY_PUBLIC_VIEWS.size) {
    return json(res, 503, {ok: false, error: 'bigquery_not_configured'});
  }
  const body = await readJson(req);
  const view = typeof body.view === 'string' ? body.view.trim() : '';
  if (!BIGQUERY_PUBLIC_VIEWS.has(view)) {
    return json(res, 403, {ok: false, error: 'view_not_allowed'});
  }
  const limit = clampInteger(body.limit, 1, 1000, 100);
  const sql = `SELECT * FROM \`${view}\` LIMIT @limit`;
  const [rows] = await bigquery.query({
    query: sql,
    params: {limit},
    useLegacySql: false,
    maximumBytesBilled: BIGQUERY_MAX_BYTES_BILLED,
  });
  return json(res, 200, {ok: true, view, count: rows.length, rows});
}

const server = http.createServer(async (req, res) => {
  try {
    if (!applyCors(req, res)) return json(res, 403, {ok: false, error: 'origin_not_allowed'});
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      return res.end();
    }
    if (!withinRateLimit(req)) return json(res, 429, {ok: false, error: 'rate_limited'});

    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/v1/status')) {
      return json(res, 200, serviceStatus());
    }

    if (req.method === 'POST') {
      const auth = validApiToken(req);
      if (!auth.ok) return json(res, auth.status, {ok: false, error: auth.error});
    }

    if (req.method === 'POST' && url.pathname === '/v1/ai/analyze') {
      return await handleAiAnalyze(req, res);
    }
    if (req.method === 'POST' && url.pathname === '/v1/places/search') {
      return await handlePlacesSearch(req, res);
    }
    if (req.method === 'POST' && url.pathname === '/v1/data/view') {
      return await handleBigQueryView(req, res);
    }
    return json(res, 404, {ok: false, error: 'not_found'});
  } catch (error) {
    console.error(error);
    return json(res, error.statusCode || 500, {
      ok: false,
      error: error.statusCode ? error.message : 'internal_error',
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`STARGATE Google Cloud API listening on ${PORT}`);
});
