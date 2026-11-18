import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { compareTopics, orderedProblems } from "../yeongjae-math/grade.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT = path.join(ROOT, "yeongjae-math", "data", "latest.json");
const NOTION_VERSION = "2025-09-03";
const TOPIC_SOURCE = "d5024ca6-3024-4a87-833c-7256a8794efa";
const PROBLEM_SOURCE = "eb5c7126-4021-49d1-8d9d-f4e9148d4775";

export const PHASES = [
  {
    id: "winter",
    title: "겨울 심화",
    start: "2026-12-28",
    end: "2027-02-27",
    note: "대수·기하·조합을 난도 1에서 3까지 한 바퀴 돕니다.",
    estimate: false,
  },
  {
    id: "documents",
    title: "5월 서류",
    start: "2027-03-02",
    end: "2027-05-08",
    note: "학교 1곳을 정하고, 주 4문항은 오답부터 다시 풉니다.",
    estimate: true,
  },
  {
    id: "stage2",
    title: "7월 2단계",
    start: "2027-05-10",
    end: "2027-07-11",
    note: "서술형 창의력으로 넘어갑니다. 날짜는 전년 일정을 1년 뒤로 옮긴 예상입니다.",
    estimate: true,
  },
];

function plainText(property) {
  const values = property?.title || property?.rich_text || [];
  return values.map((item) => item.plain_text || item.text?.content || "").join("").trim();
}

function relationIds(property) {
  return (property?.relation || []).map((item) => item.id).filter(Boolean);
}

export function pageToTopic(page) {
  if (!page || page.archived || page.in_trash) return null;
  const properties = page.properties || {};
  if (!properties["공개"]?.checkbox) return null;
  const title = plainText(properties["이름"]);
  if (!title) return null;
  return {
    id: page.id,
    title,
    area: properties["영역"]?.select?.name || "",
    order: Number(properties["순서"]?.number ?? 0),
    goal: plainText(properties["목표"]),
    prerequisiteIds: relationIds(properties["선수 토픽"]),
  };
}

export function pageToProblem(page) {
  if (!page || page.archived || page.in_trash) return null;
  const properties = page.properties || {};
  if (!properties["공개"]?.checkbox) return null;
  const prompt = plainText(properties["문제"]);
  const answer = plainText(properties["정답"]);
  const topicId = relationIds(properties["토픽"])[0];
  if (!prompt || !answer || !topicId) return null;
  return {
    id: page.id,
    title: plainText(properties["제목"]) || "제목 없는 문항",
    topicId,
    difficulty: properties["난도"]?.number ?? null,
    minutes: properties["예상 시간"]?.number ?? null,
    prompt,
    hint1: plainText(properties["힌트 1"]),
    hint2: plainText(properties["힌트 2"]),
    answer,
    solution: plainText(properties["풀이"]),
  };
}

export function buildSnapshot({ topics, problems, status, message, checkedAt }) {
  const publicTopics = topics.filter(Boolean).sort(compareTopics);
  const topicIds = new Set(publicTopics.map((topic) => topic.id));
  const cleanTopics = publicTopics.map((topic) => ({
    ...topic,
    prerequisiteIds: topic.prerequisiteIds.filter((id) => topicIds.has(id)),
  }));
  const publicProblems = orderedProblems(
    cleanTopics,
    problems.filter((problem) => problem && topicIds.has(problem.topicId)),
  );
  return {
    schemaVersion: 1,
    generatedAt: checkedAt,
    timezone: "Asia/Seoul",
    source: { status, message },
    phases: PHASES,
    topics: cleanTopics,
    problems: publicProblems,
  };
}

async function readPrevious() {
  try {
    return JSON.parse(await readFile(OUTPUT, "utf8"));
  } catch {
    return null;
  }
}

async function requestJson(url, token, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
      "User-Agent": "stargate-yeongjae-math/1.0",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.message || payload?.error || response.statusText;
    throw new Error(`${response.status} ${detail}`);
  }
  return payload;
}

async function queryAll(sourceId, token) {
  const pages = [];
  let cursor;
  do {
    const payload = await requestJson(`https://api.notion.com/v1/data_sources/${sourceId}/query`, token, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    pages.push(...(payload.results || []));
    cursor = payload.has_more ? payload.next_cursor : null;
  } while (cursor);
  return pages;
}

function sourceId(name, fallback) {
  return (process.env[name] || fallback).trim().replace(/^collection:\/\//, "");
}

async function main() {
  const checkedAt = new Date().toISOString();
  const previous = await readPrevious();
  const token = process.env.NOTION_TOKEN?.trim();
  let snapshot;
  if (!token) {
    snapshot = buildSnapshot({
      topics: previous?.topics || [],
      problems: previous?.problems || [],
      status: previous?.problems?.length ? "cached" : "setup",
      message: previous?.problems?.length
        ? "Notion API 인증 정보 대기 · 저장소에 있는 자작 문항을 표시합니다."
        : "NOTION_TOKEN이 없어 공개 문항을 가져오지 못했습니다.",
      checkedAt,
    });
  } else {
    try {
      const [topicPages, problemPages] = await Promise.all([
        queryAll(sourceId("NOTION_YEONGJAE_TOPIC_SOURCE", TOPIC_SOURCE), token),
        queryAll(sourceId("NOTION_YEONGJAE_PROBLEM_SOURCE", PROBLEM_SOURCE), token),
      ]);
      snapshot = buildSnapshot({
        topics: topicPages.map(pageToTopic),
        problems: problemPages.map(pageToProblem),
        status: "live",
        message: `공개 토픽 ${topicPages.filter(pageToTopic).length}개 · 공개 문항 ${problemPages.filter(pageToProblem).length}개`,
        checkedAt,
      });
    } catch (error) {
      console.error(`Notion sync failed: ${error.message}`);
      snapshot = buildSnapshot({
        topics: previous?.topics || [],
        problems: previous?.problems || [],
        status: "error",
        message: "Notion 연결 오류 · 마지막 정상 문항을 표시합니다.",
        checkedAt,
      });
    }
  }

  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`yeongjae math snapshot written: ${path.relative(ROOT, OUTPUT)} (${snapshot.source.status}, ${snapshot.problems.length} problems)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
