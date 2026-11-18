import test from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot, pageToProblem, pageToTopic } from "./update-yeongjae-math.mjs";

function rich(text) {
  return { rich_text: [{ plain_text: text }] };
}

test("drops private rows and never copies page bodies", () => {
  const topic = pageToTopic({
    id: "topic-1",
    archived: false,
    properties: {
      이름: { title: [{ plain_text: "합동식과 역원" }] },
      영역: { select: { name: "대수" } },
      순서: { number: 1 },
      목표: rich("역원을 찾는다"),
      공개: { checkbox: true },
      "선수 토픽": { relation: [] },
    },
    children: [{ paragraph: "본문은 가져가지 않는다" }],
  });
  const hiddenTopic = pageToTopic({
    id: "topic-hidden",
    properties: {
      이름: { title: [{ plain_text: "비공개" }] },
      영역: { select: { name: "대수" } },
      순서: { number: 9 },
      목표: rich("숨김"),
      공개: { checkbox: false },
      "선수 토픽": { relation: [] },
    },
  });
  const problem = pageToProblem({
    id: "problem-1",
    properties: {
      제목: { title: [{ plain_text: "3의 역원" }] },
      토픽: { relation: [{ id: "topic-1" }] },
      난도: { number: 1 },
      문제: rich("3x = 1"),
      "힌트 1": rich("표를 적으시오"),
      "힌트 2": rich("3×5"),
      정답: rich("5"),
      풀이: rich("x=5"),
      "예상 시간": { number: 8 },
      공개: { checkbox: true },
    },
    body: "기출 원문처럼 보이는 본문",
  });
  const hiddenProblem = pageToProblem({
    id: "problem-hidden",
    properties: {
      제목: { title: [{ plain_text: "숨긴 문항" }] },
      토픽: { relation: [{ id: "topic-1" }] },
      문제: rich("비밀"),
      정답: rich("1"),
      공개: { checkbox: false },
    },
  });

  assert.equal(hiddenTopic, null);
  assert.equal(hiddenProblem, null);
  const snapshot = buildSnapshot({
    topics: [topic, hiddenTopic],
    problems: [problem, hiddenProblem],
    status: "live",
    message: "ok",
    checkedAt: "2026-10-27T00:00:00.000Z",
  });
  assert.deepEqual(snapshot.topics.map((item) => item.id), ["topic-1"]);
  assert.deepEqual(snapshot.problems.map((item) => item.id), ["problem-1"]);
  assert.equal(JSON.stringify(snapshot).includes("본문"), false);
  assert.equal(JSON.stringify(snapshot).includes("비밀"), false);
  assert.equal(snapshot.problems[0].answer, "5");
});

test("drops a problem whose topic is not public and dangling prerequisites", () => {
  const topics = [
    pageToTopic({
      id: "open",
      properties: {
        이름: { title: [{ plain_text: "불변량" }] },
        영역: { select: { name: "조합" } },
        순서: { number: 2 },
        목표: rich("판정"),
        공개: { checkbox: true },
        "선수 토픽": { relation: [{ id: "missing" }, { id: "open" }] },
      },
    }),
  ];
  const orphan = pageToProblem({
    id: "orphan",
    properties: {
      제목: { title: [{ plain_text: "고아" }] },
      토픽: { relation: [{ id: "missing" }] },
      문제: rich("문제"),
      정답: rich("1"),
      공개: { checkbox: true },
    },
  });
  const snapshot = buildSnapshot({
    topics,
    problems: [orphan],
    status: "live",
    message: "ok",
    checkedAt: "2026-10-27T00:00:00.000Z",
  });
  assert.deepEqual(snapshot.topics[0].prerequisiteIds, ["open"]);
  assert.equal(snapshot.problems.length, 0);
});
