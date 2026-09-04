import { readFile } from 'node:fs/promises';

const projectRef = 'inftexpcnfinglwlrvsj';
const supabaseUrl = (process.env.SUPABASE_URL || `https://${projectRef}.supabase.co`).replace(/\/$/, '');
const accessToken = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();
const dbUrl = (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '').trim();
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const sql = await readFile('supabase/migrations/202609040001_create_koi_recommendation.sql', 'utf8');

async function viaManagementApi() {
  if (!accessToken) return false;
  const r = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Management API SQL failed (${r.status}): ${text.slice(0,500)}`);
  console.log('KOI schema applied via Supabase Management API.');
  return true;
}

async function viaRestProbe() {
  if (!serviceKey) return false;
  const r = await fetch(`${supabaseUrl}/rest/v1/koi_problems?select=id,external_id,title&limit=5`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  const text = await r.text();
  console.log(`KOI table probe HTTP ${r.status}: ${text.slice(0,300)}`);
  return r.ok;
}

let applied = false;
try { applied = await viaManagementApi(); } catch (e) { console.error(e.message); }
const exists = await viaRestProbe();
if (!applied && !exists) {
  console.error('KOI Supabase schema not applied. Configure SUPABASE_ACCESS_TOKEN (preferred) or apply the migration in Supabase SQL Editor.');
  process.exit(1);
}
console.log(`KOI Supabase ready: schemaApplied=${applied}, tableReachable=${exists}`);
