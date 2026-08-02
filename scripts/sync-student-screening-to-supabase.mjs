import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!supabaseUrl && !serviceKey) {
  console.log("Supabase secrets not configured; database sync skipped.");
  process.exit(0);
}
if (!supabaseUrl || !serviceKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured together.");
}

const url = new URL(supabaseUrl);
if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co")) {
  throw new Error("SUPABASE_URL must be an HTTPS supabase.co project URL.");
}

const data = JSON.parse(
  await readFile(resolve("teacher-screening/data/latest.json"), "utf8")
);
if (!Array.isArray(data.candidates) || data.candidates.length > 100) {
  throw new Error("Screening data must contain at most 100 candidates.");
}

const batchId = data.updatedAt;
const headers = {
  apikey: serviceKey,
  "content-type": "application/json",
  prefer: "resolution=merge-duplicates,return=minimal",
};
if (!serviceKey.startsWith("sb_secret_")) {
  headers.authorization = `Bearer ${serviceKey}`;
}

async function upsert(table, rows, conflictColumns) {
  const endpoint = new URL(`/rest/v1/${table}`, supabaseUrl);
  endpoint.searchParams.set("on_conflict", conflictColumns);
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 600);
    throw new Error(`Supabase ${table} upsert failed (HTTP ${response.status}): ${detail}`);
  }
}

await upsert(
  "student_screening_batches",
  [{
    batch_id: batchId,
    source: data.source,
    mode: data.mode,
    screened_at: data.updatedAt,
    next_run_at: data.nextRunAt,
    candidate_count: data.batchSize,
    priority_count: data.summary.priority,
    review_count: data.summary.review,
    hold_count: data.summary.hold,
    average_score: data.summary.averageScore,
    raw_summary: data.summary,
  }],
  "batch_id"
);

await upsert(
  "student_screening_candidates",
  data.candidates.map((candidate) => ({
    batch_id: batchId,
    external_id: candidate.id,
    rank: candidate.rank,
    display_name: candidate.name,
    school_level: candidate.schoolLevel,
    subject: candidate.subject,
    goal: candidate.goal,
    region: candidate.region,
    weekly_sessions: candidate.weeklySessions,
    budget_monthly: candidate.budgetMonthly,
    schedule_fit: candidate.scheduleFit,
    guardian_verified: candidate.guardianVerified,
    remote: candidate.remote,
    requested_at: candidate.requestedAt,
    request_age_days: candidate.requestAgeDays,
    score: candidate.score,
    status: candidate.status,
    profile_url: candidate.profileUrl,
    raw_data: candidate,
  })),
  "batch_id,external_id"
);

console.log(`Supabase sync complete: batch ${batchId}, ${data.candidates.length} students.`);

