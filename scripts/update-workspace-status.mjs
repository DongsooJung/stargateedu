import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT = path.join(ROOT, "pmo", "data", "latest.json");
const NOTION_VERSION = "2025-09-03";
const DEFAULT_NOTION_SOURCE = "389627e7-cf3f-46ca-be31-2f83afd2dc6d";
const now = new Date().toISOString();

async function readPrevious() {
  try {
    return JSON.parse(await readFile(OUTPUT, "utf8"));
  } catch {
    return { projects: [], sources: {} };
  }
}

function sourceState(status, message, lastSuccessfulSync = null) {
  return { status, message, checkedAt: now, lastSuccessfulSync };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      "User-Agent": "stargate-workspace-status/1.0",
      ...options.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.message || body?.error_description || body?.error || response.statusText;
    throw new Error(`${response.status} ${detail}`);
  }
  return body;
}

function plainText(property) {
  if (!property) return "";
  const values = property.title || property.rich_text || [];
  return values.map((item) => item.plain_text || item.text?.content || "").join("").trim();
}

function findProperty(properties, names, type) {
  for (const name of names) {
    if (properties?.[name] && (!type || properties[name].type === type)) return properties[name];
  }
  return Object.values(properties || {}).find((property) => !type || property.type === type);
}

function normalizeNotionPage(page, sourceId) {
  const properties = page.properties || {};
  const titleProperty = findProperty(properties, ["프로젝트명", "프로젝트", "Name", "이름"], "title");
  const statusProperty = findProperty(properties, ["상태", "Status"]);
  const nextProperty = findProperty(properties, ["다음 1액션", "다음 행동", "Next action"]);
  const checklistNames = ["(1) 목표 확정", "(2) 템플릿", "(3) 루틴 연결", "(4) 첫 산출물"];
  const availableChecks = checklistNames.filter((name) => properties[name]?.type === "checkbox");
  const completedChecks = availableChecks.filter((name) => properties[name].checkbox).length;
  const formulaProgress = properties["진행률(%)"]?.formula?.number;
  const numberProgress = properties["진행률"]?.number;
  const rawProgress = Number.isFinite(formulaProgress) ? formulaProgress : numberProgress;
  const progress = Number.isFinite(rawProgress)
    ? Math.round(rawProgress <= 1 ? rawProgress * 100 : rawProgress)
    : availableChecks.length
      ? Math.round((completedChecks / availableChecks.length) * 100)
      : null;

  return {
    id: page.id,
    source: "notion",
    sourceId,
    title: plainText(titleProperty) || "제목 없는 프로젝트",
    status: statusProperty?.status?.name || statusProperty?.select?.name || "미분류",
    progress,
    nextAction: plainText(nextProperty) || "",
    updatedAt: page.last_edited_time || page.created_time || null,
    url: page.url || "",
  };
}

async function fetchNotion(previous) {
  const token = process.env.NOTION_TOKEN?.trim();
  const sourceIds = (process.env.NOTION_DATA_SOURCE_IDS || DEFAULT_NOTION_SOURCE)
    .split(",")
    .map((value) => value.trim().replace(/^collection:\/\//, ""))
    .filter(Boolean);
  if (!token) {
    return {
      projects: previous.projects || [],
      state: sourceState(
        "cached",
        "Notion API 인증 정보 대기 · 마지막 정상 데이터를 표시합니다.",
        previous.sources?.notion?.lastSuccessfulSync || previous.generatedAt || null,
      ),
    };
  }

  const projects = [];
  for (const sourceId of sourceIds) {
    let cursor;
    do {
      const payload = await requestJson(`https://api.notion.com/v1/data_sources/${sourceId}/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
      });
      projects.push(...(payload.results || []).map((page) => normalizeNotionPage(page, sourceId)));
      cursor = payload.has_more ? payload.next_cursor : null;
    } while (cursor);
  }

  projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return {
    projects,
    state: sourceState("live", `Notion 프로젝트 ${projects.length}건 동기화`, now),
  };
}

const previous = await readPrevious();
let notion;
try {
  notion = await fetchNotion(previous);
} catch (error) {
  console.error(`Notion sync failed: ${error.message}`);
  notion = {
    projects: previous.projects || [],
    state: sourceState(
      "error",
      "Notion 연결 오류 · 마지막 정상 데이터를 표시합니다.",
      previous.sources?.notion?.lastSuccessfulSync || null,
    ),
  };
}
const activeProjects = notion.projects.filter((project) => !/완료|done|complete/i.test(project.status));
const completedProjects = notion.projects.length - activeProjects.length;
const progressValues = notion.projects.map((project) => project.progress).filter(Number.isFinite);
const averageProgress = progressValues.length
  ? Math.round(progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length)
  : null;

const output = {
  schemaVersion: 1,
  generatedAt: now,
  timezone: "Asia/Seoul",
  summary: {
    notionProjects: notion.projects.length,
    activeProjects: activeProjects.length,
    completedProjects,
    averageProgress,
  },
  sources: { notion: notion.state },
  projects: notion.projects,
};

await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`workspace status written: ${path.relative(ROOT, OUTPUT)}`);
