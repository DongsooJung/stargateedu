import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT = path.join(ROOT, "pmo", "data", "latest.json");
const NOTION_VERSION = "2025-09-03";
const DEFAULT_NOTION_SOURCE = "5e1e339e-3a7f-40b9-9690-93a8b1f6a16f";
const now = new Date().toISOString();

async function readPrevious() {
  try {
    return JSON.parse(await readFile(OUTPUT, "utf8"));
  } catch {
    return { projects: [], notes: [], repositories: [], sources: {} };
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

async function getGraphAccessToken() {
  const clientId = process.env.MS_CLIENT_ID?.trim();
  const refreshToken = process.env.MS_REFRESH_TOKEN?.trim();
  if (!clientId || !refreshToken) return null;
  const tenant = process.env.MS_TENANT_ID?.trim() || "common";
  const form = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: "offline_access Notes.Read User.Read",
  });
  if (process.env.MS_CLIENT_SECRET?.trim()) form.set("client_secret", process.env.MS_CLIENT_SECRET.trim());
  return requestJson(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
}

async function fetchOneNote(previous) {
  const tokenPayload = await getGraphAccessToken();
  if (!tokenPayload?.access_token) {
    return {
      notes: previous.notes || [],
      state: sourceState(
        "setup",
        "Microsoft Graph 위임형 OAuth 연결이 필요합니다.",
        previous.sources?.onenote?.lastSuccessfulSync || null,
      ),
    };
  }

  const sectionAllowlist = new Set(
    (process.env.ONENOTE_SECTION_IDS || "").split(",").map((value) => value.trim()).filter(Boolean),
  );
  const publishAll = process.env.ONENOTE_PUBLISH_ALL === "true";
  const publicPrefix = process.env.ONENOTE_PUBLIC_PREFIX || "[PUBLIC]";
  const payload = await requestJson(
    "https://graph.microsoft.com/v1.0/me/onenote/pages?$select=id,title,createdDateTime,lastModifiedDateTime,links,parentSection&$orderby=lastModifiedDateTime%20desc&$top=100",
    { headers: { Authorization: `Bearer ${tokenPayload.access_token}` } },
  );
  const allPages = payload.value || [];
  const notes = allPages
    .filter((page) => publishAll || sectionAllowlist.has(page.parentSection?.id) || page.title?.startsWith(publicPrefix))
    .slice(0, 30)
    .map((page) => ({
      id: page.id,
      source: "onenote",
      title: page.title?.startsWith(publicPrefix) ? page.title.slice(publicPrefix.length).trim() : page.title,
      section: page.parentSection?.displayName || "OneNote",
      updatedAt: page.lastModifiedDateTime || page.createdDateTime || null,
      url: page.links?.oneNoteWebUrl?.href || "",
    }));

  return {
    notes,
    state: sourceState("live", `OneNote 공개 페이지 ${notes.length}건 동기화`, now),
    rotatedRefreshToken: tokenPayload.refresh_token,
  };
}

async function fetchGitHub(previous) {
  const owner = process.env.GITHUB_OWNER || "DongsooJung";
  const headers = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
  const repos = await requestJson(`https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=100&sort=updated`, { headers });
  const repositories = repos
    .filter((repo) => !repo.fork && !repo.archived && /stargate|별의문/i.test(`${repo.name} ${repo.description || ""}`))
    .slice(0, 20)
    .map((repo) => ({
      id: String(repo.id),
      source: "github",
      title: repo.name,
      description: repo.description || "",
      updatedAt: repo.pushed_at || repo.updated_at,
      url: repo.html_url,
      visibility: repo.visibility || (repo.private ? "private" : "public"),
    }));
  return { repositories, state: sourceState("live", `GitHub 프로젝트 ${repositories.length}건 동기화`, now) };
}

const previous = await readPrevious();
const results = await Promise.allSettled([
  fetchNotion(previous),
  fetchOneNote(previous),
  fetchGitHub(previous),
]);

function settled(index, key, source) {
  const result = results[index];
  if (result.status === "fulfilled") return result.value;
  return {
    [key]: previous[key] || [],
    state: sourceState(
      "error",
      `${source} 연결 오류 · 마지막 정상 데이터를 표시합니다.`,
      previous.sources?.[source.toLowerCase()]?.lastSuccessfulSync || null,
    ),
  };
}

const notion = settled(0, "projects", "Notion");
const onenote = settled(1, "notes", "OneNote");
const github = settled(2, "repositories", "GitHub");
const activeProjects = notion.projects.filter((project) => !/완료|done|complete/i.test(project.status));
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
    averageProgress,
    oneNotePages: onenote.notes.length,
    githubProjects: github.repositories.length,
  },
  sources: { notion: notion.state, onenote: onenote.state, github: github.state },
  projects: notion.projects,
  notes: onenote.notes,
  repositories: github.repositories,
};

await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`workspace status written: ${path.relative(ROOT, OUTPUT)}`);
if (onenote.rotatedRefreshToken && onenote.rotatedRefreshToken !== process.env.MS_REFRESH_TOKEN) {
  console.log("::notice::Microsoft issued a rotated refresh token. Update MS_REFRESH_TOKEN to keep the connection durable.");
}
