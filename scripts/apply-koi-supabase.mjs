import { readFile } from 'node:fs/promises';

const projectRef = 'inftexpcnfinglwlrvsj';
const supabaseUrl = (process.env.SUPABASE_URL || `https://${projectRef}.supabase.co`).replace(/\/$/, '');
const accessToken = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const sql = await readFile('supabase/migrations/202609040001_create_koi_recommendation.sql', 'utf8');

async function readPublishableKey() {
  const source = await readFile('koi-coach/ai-recommend/supabase-config.js', 'utf8');
  const match = source.match(/publishableKey:\s*['"]([^'"]+)['"]/);
  return match?.[1]?.trim() || '';
}

async function viaManagementApi() {
  if (!accessToken) return false;
  const r = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Management API SQL failed (${r.status}): ${text.slice(0, 500)}`);
  console.log('KOI schema applied via Supabase Management API.');
  return true;
}

async function viaRestProbe() {
  const publishableKey = await readPublishableKey();
  const probeKey = serviceKey || publishableKey;
  if (!probeKey) return false;
  const r = await fetch(`${supabaseUrl}/rest/v1/koi_problems?select=id,external_id,title&limit=5`, {
    headers: { apikey: probeKey, Authorization: `Bearer ${probeKey}` },
  });
  const text = await r.text();
  console.log(`KOI public table probe HTTP ${r.status}: ${text.slice(0, 300)}`);
  return r.ok;
}

let applied = false;
try {
  applied = await viaManagementApi();
} catch (e) {
  console.error(e.message);
}

const exists = await viaRestProbe();
if (!applied && !exists) {
  console.error('KOI Supabase schema is not reachable. Configure SUPABASE_ACCESS_TOKEN to apply the migration, or apply it once in Supabase SQL Editor.');
  process.exit(1);
}
console.log(`KOI Supabase ready: schemaApplied=${applied}, tableReachable=${exists}`);
