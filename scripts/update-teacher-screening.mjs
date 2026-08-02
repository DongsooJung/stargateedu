import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const MAX_BATCH_SIZE = 100;
const outputPath = resolve("teacher-screening/data/latest.json");
const exportUrl = process.env.AUTHORIZED_CANDIDATE_EXPORT_URL?.trim();

const subjects = ["수학", "정보·코딩", "과학", "영어", "학습코칭"];
const regions = ["서울 강남", "서울 송파", "서울 서초", "경기 성남", "온라인"];

function sampleCandidates() {
  return Array.from({ length: MAX_BATCH_SIZE }, (_, index) => ({
    externalId: `DEMO-${String(index + 1).padStart(3, "0")}`,
    displayName: `익명 후보 ${String(index + 1).padStart(3, "0")}`,
    subject: subjects[index % subjects.length],
    region: regions[(index * 3) % regions.length],
    experienceYears: 1 + ((index * 7) % 14),
    rating: Number((4.1 + ((index * 13) % 10) / 10).toFixed(1)),
    reviewCount: 3 + ((index * 17) % 94),
    verified: index % 7 !== 0,
    remote: index % 3 === 0,
    profileUrl: null,
  }));
}

async function loadCandidates() {
  if (!exportUrl) return { candidates: sampleCandidates(), mode: "demo" };

  const url = new URL(exportUrl);
  if (url.protocol !== "https:") {
    throw new Error("승인 데이터 URL은 HTTPS여야 합니다.");
  }
  if (/(^|\.)kimstudy\.com$/i.test(url.hostname)) {
    throw new Error(
      "kimstudy.com 페이지 직접 수집은 허용하지 않습니다. 공식 API 또는 별도로 승인된 내보내기 URL을 사용하세요."
    );
  }

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "STARGATE-EDU-Screening/1.0",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`승인 데이터 요청 실패: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const candidates = Array.isArray(payload) ? payload : payload.candidates;
  if (!Array.isArray(candidates)) {
    throw new Error("승인 데이터는 배열 또는 candidates 배열을 포함해야 합니다.");
  }

  return { candidates, mode: "authorized" };
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function scoreCandidate(candidate) {
  const subject = String(candidate.subject ?? "기타").slice(0, 40);
  const verified = Boolean(candidate.verified);
  const rating = Math.min(5, Math.max(0, number(candidate.rating)));
  const reviews = Math.max(0, number(candidate.reviewCount));
  const experience = Math.max(0, number(candidate.experienceYears));
  const subjectFit = /수학|정보|코딩|과학|학습코칭/.test(subject) ? 15 : 8;
  const score = Math.round(
    (verified ? 15 : 0) +
      (rating / 5) * 25 +
      Math.min(20, Math.log10(reviews + 1) * 10) +
      Math.min(25, experience * 2.5) +
      subjectFit
  );

  return {
    id: String(candidate.externalId ?? candidate.id ?? crypto.randomUUID()).slice(0, 80),
    name: String(candidate.displayName ?? candidate.name ?? "익명 후보").slice(0, 80),
    subject,
    region: String(candidate.region ?? "미기재").slice(0, 60),
    experienceYears: Math.round(experience * 10) / 10,
    rating: Math.round(rating * 10) / 10,
    reviewCount: Math.round(reviews),
    verified,
    remote: Boolean(candidate.remote),
    profileUrl: candidate.profileUrl ? String(candidate.profileUrl).slice(0, 500) : null,
    score: Math.min(100, score),
    status: score >= 85 ? "priority" : score >= 70 ? "review" : "hold",
  };
}

const { candidates, mode } = await loadCandidates();
const screened = candidates
  .slice(0, MAX_BATCH_SIZE)
  .map(scoreCandidate)
  .sort((a, b) => b.score - a.score)
  .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

const updatedAt = new Date();
const nextRunAt = new Date(updatedAt);
nextRunAt.setUTCDate(nextRunAt.getUTCDate() + ((8 - nextRunAt.getUTCDay()) % 7 || 7));
nextRunAt.setUTCHours(0, 15, 0, 0);

const output = {
  source: mode === "authorized" ? "승인된 후보 데이터" : "익명 데모 데이터",
  mode,
  updatedAt: updatedAt.toISOString(),
  nextRunAt: nextRunAt.toISOString(),
  batchSize: screened.length,
  summary: {
    priority: screened.filter((item) => item.status === "priority").length,
    review: screened.filter((item) => item.status === "review").length,
    hold: screened.filter((item) => item.status === "hold").length,
    averageScore: screened.length
      ? Math.round(screened.reduce((sum, item) => sum + item.score, 0) / screened.length)
      : 0,
  },
  candidates: screened,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`교사 후보 ${screened.length}명 스크리닝 완료 (${mode})`);
