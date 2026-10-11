// Edge Function: inquiry — 모든 사이트 공용 상담 문의 접수 창구
// POST https://inftexpcnfinglwlrvsj.supabase.co/functions/v1/inquiry
// verify_jwt=false (공개 폼). 대신 허용 출처, honeypot, 제출 속도, IP 레이트리밋으로 방어합니다.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const IP_SALT = Deno.env.get("INQUIRY_IP_SALT") ?? SERVICE_KEY.slice(-24);
const NOTIFY_KEY = Deno.env.get("NOTIFY_API_KEY") ?? "";
const RATE_LIMIT = Number(Deno.env.get("INQUIRY_RATE_PER_10MIN") ?? "3");
const ADMIN_URL = "https://stargateedu.co.kr/admin/inquiries/";

const CATEGORIES: Record<string, string> = {
  koi: "KOI·정보올림피아드", math: "수학 심화", ai_dev: "AI 개발·외주",
  publishing: "전자출판", partnership: "제휴·투자", other: "기타",
};

const ORIGINS = new Set([
  "https://stargateedu.co.kr", "https://www.stargateedu.co.kr",
  "https://lp.stargateedu.co.kr", "https://portal.stargateedu.co.kr",
  "https://blog.stargateedu.co.kr", "https://shop.stargateedu.co.kr",
  "https://stargate-homepage.vercel.app",
]);
function okOrigin(o: string | null): string | null {
  if (!o) return null;
  if (ORIGINS.has(o)) return o;
  try {
    const h = new URL(o).host;
    if (/^stargate-homepage-[a-z0-9-]+\.vercel\.app$/.test(h)) return o; // Vercel 프리뷰
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h)) return o;          // 로컬 개발
  } catch { /* noop */ }
  return null;
}

function sourceFromOrigin(o: string | null): string {
  if (!o) return "unknown";
  const h = new URL(o).host;
  if (h.includes("stargate-homepage")) return "homepage";
  if (h.startsWith("lp.")) return "lp";
  if (h.startsWith("blog.")) return "blog";
  if (h.startsWith("shop.")) return "shop";
  if (h.startsWith("portal.")) return "portal-main";
  if (h.includes("stargateedu.co.kr")) return "portal";
  return "dev";
}

const clean = (v: unknown, max: number) =>
  v == null ? "" : String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);

type Valid = { ok: true; row: Record<string, unknown> } | { ok: false; spam?: boolean; field?: string; message?: string };

export function validate(b: Record<string, unknown>): Valid {
  if (clean(b.website, 200)) return { ok: false, spam: true };
  const elapsed = Number(b.elapsed_ms);
  if (!Number.isFinite(elapsed) || elapsed < 3000 || elapsed > 86_400_000) return { ok: false, spam: true };

  // 포털 /consult/ 간편 신청은 유형·내용 없이 이름·연락처만 받으므로 기본값 처리
  const quick = b.mode === "quick";
  const category = clean(b.category, 20) || (quick ? "other" : "");
  if (!CATEGORIES[category]) return { ok: false, field: "category", message: "문의 유형을 선택해 주세요." };
  const name = clean(b.name, 40);
  if (!name) return { ok: false, field: "name", message: "성함을 입력해 주세요." };
  const phone = clean(b.phone, 20).replace(/\D/g, "");
  if (!/^0\d{8,10}$/.test(phone)) return { ok: false, field: "phone", message: "연락처를 정확히 입력해 주세요. (예: 010-1234-5678)" };
  const email = clean(b.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, field: "email", message: "이메일 형식을 확인해 주세요." };
  let message = clean(b.message, 2000);
  if (quick && !message) message = "간편 상담 신청 (내용 없음)";
  if (!quick && message.length < 5) return { ok: false, field: "message", message: "문의 내용을 5자 이상 입력해 주세요." };
  if (b.consent !== true) return { ok: false, field: "consent", message: "개인정보 수집·이용에 동의해 주셔야 접수할 수 있습니다." };

  const utmIn = (b.utm && typeof b.utm === "object") ? b.utm as Record<string, unknown> : {};
  const utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"]) {
    const v = clean(utmIn[k], 120); if (v) utm[k] = v;
  }
  return {
    ok: true,
    row: {
      category, name, phone,
      email: email || null,
      student_grade: clean(b.student_grade, 20) || null,
      preferred_time: clean(b.preferred_time, 60) || null,
      message,
      is_guardian: b.is_guardian === true,
      marketing_ok: b.marketing_ok === true,
      consent_at: new Date().toISOString(),
      provider: clean(b.provider, 20) || "direct",
      utm,
      referrer: clean(b.referrer, 300) || null,
      page: clean(b.page, 300) || null,
    },
  };
}

const fmtPhone = (p: string) =>
  p.length === 11 ? `${p.slice(0, 3)}-${p.slice(3, 7)}-${p.slice(7)}`
  : p.startsWith("02") ? (p.length === 10 ? `02-${p.slice(2, 6)}-${p.slice(6)}` : `02-${p.slice(2, 5)}-${p.slice(5)}`)
  : `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`;

// 카카오톡 "나에게 보내기"는 200자 제한 → 핵심만
export function kakaoText(r: Record<string, any>): string {
  const head = `[문의 ${r.grade ?? "-"}·${r.score ?? "-"}점] ${CATEGORIES[r.category]}`;
  const who = `${r.name}${r.is_guardian ? "(보호자)" : ""} ${fmtPhone(r.phone)}`;
  const meta = [r.student_grade, r.preferred_time, r.source_site].filter(Boolean).join(" · ");
  const fixed = [head, who, meta].filter(Boolean).join("\n");
  const room = 200 - fixed.length - 2;
  const msg = r.message.length > room ? r.message.slice(0, Math.max(room - 1, 0)) + "…" : r.message;
  return room > 10 ? `${fixed}\n${msg}` : fixed.slice(0, 200);
}

async function sb(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function json(status: number, body: unknown, origin: string | null) {
  const h: Record<string, string> = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (origin) Object.assign(h, { "Access-Control-Allow-Origin": origin, Vary: "Origin" });
  return new Response(JSON.stringify(body), { status, headers: h });
}

Deno.serve(async (req) => {
  const origin = okOrigin(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: origin ? {
        "Access-Control-Allow-Origin": origin, Vary: "Origin",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
        "Access-Control-Max-Age": "86400",
      } : {},
    });
  }
  if (req.method !== "POST") return json(405, { ok: false, message: "POST만 허용됩니다." }, origin);
  if (req.headers.get("origin") && !origin) return json(403, { ok: false, message: "허용되지 않은 출처입니다." }, null);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { ok: false, message: "잘못된 요청입니다." }, origin); }

  const v = validate(body);
  if (!v.ok) return v.spam ? json(200, { ok: true }, origin) : json(400, { ok: false, field: v.field, message: v.message }, origin);

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "";
  const ipHash = await sha(`${IP_SALT}:${ip}`);

  try {
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const c = await sb(`inquiries?select=id&ip_hash=eq.${ipHash}&created_at=gte.${encodeURIComponent(since)}`, {
      method: "HEAD", headers: { Prefer: "count=exact" },
    });
    const recent = Number((c.headers.get("content-range") ?? "*/0").split("/")[1]) || 0;
    if (recent >= RATE_LIMIT) return json(429, { ok: false, message: "잠시 후 다시 시도해 주세요. 급한 문의는 전화로 연락 주세요." }, origin);

    const row = {
      ...v.row,
      source_site: clean(body.source_site, 30) || sourceFromOrigin(req.headers.get("origin")),
      ip_hash: ipHash,
      user_agent: clean(req.headers.get("user-agent"), 300) || null,
    };
    const ins = await sb("inquiries", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
    if (!ins.ok) {
      console.error("insert failed", ins.status, await ins.text());
      return json(500, { ok: false, message: "접수 중 오류가 발생했습니다. 전화로 문의해 주세요." }, origin);
    }
    const saved = (await ins.json())[0];

    // 카카오톡 알림 (기존 kakao-notify 재사용). 실패해도 접수는 성공 처리
    const notify = fetch(`${SUPABASE_URL}/functions/v1/kakao-notify?action=send`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(NOTIFY_KEY ? { "x-api-key": NOTIFY_KEY } : {}) },
      body: JSON.stringify({ message: kakaoText(saved), ...(NOTIFY_KEY ? { api_key: NOTIFY_KEY } : {}) }),
    }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.success) await sb(`inquiries?id=eq.${saved.id}`, { method: "PATCH", body: JSON.stringify({ notified: true }) });
      else console.error("kakao notify failed", r.status, JSON.stringify(j).slice(0, 300));
    }).catch((e) => console.error("kakao notify error", e));
    // @ts-ignore EdgeRuntime는 Supabase 런타임 전역
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(notify); else await notify;

    return json(200, { ok: true, id: String(saved.id).slice(0, 8) }, origin);
  } catch (e) {
    console.error("inquiry error", e);
    return json(500, { ok: false, message: "접수 중 오류가 발생했습니다. 전화로 문의해 주세요." }, origin);
  }
});

export { ADMIN_URL };
