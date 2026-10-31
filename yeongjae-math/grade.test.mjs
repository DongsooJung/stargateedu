import test from "node:test";
import assert from "node:assert/strict";
import { answersMatch, orderedProblems, phaseState } from "./grade.mjs";

const cases = [
  ["5", "5", true],
  ["5", "15", false],
  ["2", "2", true],
  ["(6, 2), (3, 4)", "(3, 4), (6, 2)", true],
  ["(6, 2), (3, 4)", "(6, 2), (4, 3)", false],
  ["(2, -1)", "2, -1", true],
  ["(2, -1)", "-1, 2", false],
  ["9", "9개", true],
  ["105, 100", "105 100", true],
  ["105, 100", "100, 105", false],
  ["105, 100", "∠C=105°, ∠D=100°", true],
  ["60/13", "60 / 13", true],
  ["60/13", "60, 13", false],
  ["60/13", "h=60/13", true],
  ["15", "15", true],
  ["12", "12", true],
  ["불가능", "불가능", true],
  ["불가능", "할 수 없다", true],
  ["불가능", "가능", false],
  ["가능, 6", "가능하다 6번", true],
  ["가능, 6", "6", false],
  ["가능, 6", "불가능", false],
  ["5", "   ", false],
];

for (const [canonical, input, expected] of cases) {
  test(`answers ${input} against ${canonical}`, () => {
    assert.equal(answersMatch(input, canonical), expected);
  });
}

test("orders problems by area, topic, then difficulty", () => {
  const topics = [
    { id: "c", area: "조합", order: 1, title: "짝" },
    { id: "a", area: "대수", order: 2, title: "부정방정식" },
    { id: "b", area: "대수", order: 1, title: "합동" },
  ];
  const problems = [
    { id: "3", topicId: "a", difficulty: 1, title: "뒤" },
    { id: "1", topicId: "b", difficulty: 2, title: "중" },
    { id: "2", topicId: "c", difficulty: 1, title: "조합" },
    { id: "0", topicId: "b", difficulty: 1, title: "앞" },
  ];
  assert.deepEqual(orderedProblems(topics, problems).map((problem) => problem.id), ["0", "1", "3", "2"]);
});

test("marks the season before winter as upcoming", () => {
  const phases = [
    { id: "winter", title: "겨울 심화", start: "2026-12-28", end: "2027-02-27" },
    { id: "docs", title: "5월 서류", start: "2027-03-02", end: "2027-05-08" },
  ];
  assert.equal(phaseState(phases, "2026-10-27").status, "upcoming");
  assert.equal(phaseState(phases, "2026-10-27").phase.id, "winter");
  assert.equal(phaseState(phases, "2027-01-10").phase.id, "winter");
  assert.equal(phaseState(phases, "2027-04-01").status, "current");
  assert.equal(phaseState(phases, "2027-09-01").status, "done");
});
