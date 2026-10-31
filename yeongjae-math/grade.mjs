const AREA_ORDER = ["대수", "기하", "조합"];

function base(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[−–—]/g, "-")
    .replace(/\\dfrac\{(-?\d+)\}\{(-?\d+)\}/g, "$1/$2")
    .replace(/\\frac\{(-?\d+)\}\{(-?\d+)\}/g, "$1/$2")
    .replace(/÷/g, "/")
    .replace(/[°º]/g, "")
    .replace(/도/g, "")
    .replace(/∠/g, "");
}

function compact(value) {
  return base(value).replace(/\s+/g, "").toLowerCase();
}

function integers(value) {
  return [...base(value).matchAll(/-?\d+/g)].map((match) => Number(match[0]));
}

function pairKeys(value) {
  const compactValue = compact(value);
  const wrapped = [...compactValue.matchAll(/\((-?\d+),(-?\d+)\)/g)].map((match) => `${match[1]},${match[2]}`);
  if (wrapped.length) return wrapped.sort();
  const nums = integers(value);
  if (nums.length < 2 || nums.length % 2 !== 0) return [];
  const pairs = [];
  for (let index = 0; index < nums.length; index += 2) pairs.push(`${nums[index]},${nums[index + 1]}`);
  return pairs.sort();
}

function saysImpossible(value) {
  const text = compact(value);
  return text.includes("불가능") || text.includes("불가") || text.includes("없다") || text.includes("할수없");
}

function saysPossible(value) {
  const text = compact(value);
  return !saysImpossible(text) && text.includes("가능");
}

export function answersMatch(input, canonical) {
  const given = compact(input);
  const expected = compact(canonical);
  if (!given || !expected) return false;
  if (given === expected) return true;

  const fraction = expected.match(/^(-?\d+)\/(-?\d+)$/);
  if (fraction) {
    const found = [...given.matchAll(/(-?\d+)\/(-?\d+)/g)];
    return found.length === 1 && found[0][1] === fraction[1] && found[0][2] === fraction[2] && integers(input).length === 2;
  }

  if (saysImpossible(expected)) return saysImpossible(given);

  if (expected.includes("(") && pairKeys(canonical).length) {
    const expectedPairs = pairKeys(canonical);
    const givenPairs = pairKeys(input);
    return givenPairs.length === expectedPairs.length && givenPairs.every((pair, index) => pair === expectedPairs[index]);
  }

  if (saysPossible(expected)) {
    return saysPossible(given) && integers(canonical).join(",") === integers(input).join(",");
  }

  const expectedInts = integers(canonical);
  const givenInts = integers(input);
  return expectedInts.length > 0 && expectedInts.join(",") === givenInts.join(",");
}

export function compareTopics(left, right) {
  const area = AREA_ORDER.indexOf(left.area) - AREA_ORDER.indexOf(right.area);
  if (area) return area;
  return (left.order ?? 0) - (right.order ?? 0) || String(left.title).localeCompare(String(right.title), "ko");
}

export function orderedProblems(topics, problems) {
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  return [...problems].sort((left, right) => {
    const topicOrder = compareTopics(topicById.get(left.topicId) || {}, topicById.get(right.topicId) || {});
    if (topicOrder) return topicOrder;
    return (left.difficulty ?? 0) - (right.difficulty ?? 0) || String(left.title).localeCompare(String(right.title), "ko");
  });
}

export function seoulDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function phaseState(phases, today = seoulDateKey()) {
  const dated = (phases || []).filter((phase) => phase.start && phase.end);
  const current = dated.find((phase) => today >= phase.start && today <= phase.end);
  if (current) return { status: "current", phase: current };
  const upcoming = dated.find((phase) => today < phase.start);
  if (upcoming) return { status: "upcoming", phase: upcoming };
  return { status: "done", phase: dated.at(-1) || null };
}
