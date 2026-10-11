// Edge Function: inquiry-weekly-report — 매주 월요일 오전 지난 7일 문의 요약을 카카오톡으로 발송
// pg_cron이 호출. verify_jwt=true(anon 키 필요) + 6일 내 중복 발송 차단으로 남용을 막습니다.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NOTIFY_KEY = Deno.env.get("NOTIFY_API_KEY") ?? "";
const CAT: Record<string, string> = { koi: "KOI", math: "수학", ai_dev: "AI개발", publishing: "출판", partnership: "제휴", other: "기타" };

const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

export function reportText(s: any, from: Date, to: Date): string {
  const d = (x: Date) => `${x.getUTCMonth() + 1}/${x.getUTCDate()}`;
  const kst = (x: Date) => new Date(x.getTime() + 9 * 3600_000);
  const diff = s.total - s.prev_total;
  const cats = Object.entries(s.by_category ?? {}).sort((a: any, b: any) => b[1] - a[1]).map(([k, n]) => `${CAT[k] ?? k}${n}`).join(" ");
  const srcs = Object.entries(s.by_source ?? {}).slice(0, 3).map(([k, n]) => `${k}${n}`).join(" ");
  return [
    `[주간 문의 ${d(kst(from))}~${d(new Date(kst(to).getTime() - 1))}]`,
    `접수 ${s.total}건(${diff >= 0 ? "+" : ""}${diff}) · S/A ${s.top_grade} · 등록 ${s.enrolled}`,
    cats && `유형: ${cats}`,
    srcs && `유입: ${srcs}`,
    `미응대 ${s.open_new}건${s.stale_new ? `(24h초과 ${s.stale_new})` : ""}`,
    s.median_first_contact_h != null ? `첫 연락 중앙값 ${s.median_first_contact_h}시간` : "",
  ].filter(Boolean).join("\n").slice(0, 200);
}

Deno.serve(async (req) => {
  const force = new URL(req.url).searchParams.get("dry_run") === "1";
  const to = new Date(); to.setUTCMinutes(0, 0, 0);
  const from = new Date(to.getTime() - 7 * 86400_000);

  // 6일 내 이미 발송했으면 생략 (dry_run 제외)
  if (!force) {
    const since = new Date(Date.now() - 6 * 86400_000).toISOString();
    const r = await fetch(`${SUPABASE_URL}/rest/v1/inquiry_reports?select=id&sent_at=gte.${encodeURIComponent(since)}&limit=1`, { headers: h });
    if ((await r.json()).length) return Response.json({ ok: true, skipped: "already_sent" });
  }

  const st = await fetch(`${SUPABASE_URL}/rest/v1/rpc/inquiry_weekly_stats`, {
    method: "POST", headers: h, body: JSON.stringify({ p_from: from.toISOString(), p_to: to.toISOString() }),
  });
  if (!st.ok) return Response.json({ ok: false, error: await st.text() }, { status: 500 });
  const stats = await st.json();
  const text = reportText(stats, from, to);
  if (force) return Response.json({ ok: true, dry_run: true, text, stats });

  const k = await fetch(`${SUPABASE_URL}/functions/v1/kakao-notify?action=send`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(NOTIFY_KEY ? { "x-api-key": NOTIFY_KEY } : {}) },
    body: JSON.stringify({ message: text, ...(NOTIFY_KEY ? { api_key: NOTIFY_KEY } : {}) }),
  });
  const kj = await k.json().catch(() => ({}));
  await fetch(`${SUPABASE_URL}/rest/v1/inquiry_reports`, {
    method: "POST", headers: h,
    body: JSON.stringify({ period_from: from.toISOString(), period_to: to.toISOString(), payload: { stats, text, kakao_ok: !!kj.success } }),
  });
  return Response.json({ ok: !!kj.success, text });
});
