import { answersMatch, orderedProblems, phaseState } from "./grade.mjs";

const STORAGE_KEY = "yeongjae-math-progress-v1";
const LEVEL = { 1: "입문", 2: "유형", 3: "심화" };
const view = document.querySelector("#view");
const phasesEl = document.querySelector("#phases");
const sourceEl = document.querySelector("#source");
let pack = null;
let draft = { id: "", value: "" };

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

function loadProgress() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveProgress(progress) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function typeset(root) {
  if (!root || typeof window.renderMathInElement !== "function") return;
  window.renderMathInElement(root, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
    ],
    throwOnError: false,
  });
}

function problems() {
  return orderedProblems(pack.topics || [], pack.problems || []);
}

function topicById(id) {
  return (pack.topics || []).find((topic) => topic.id === id);
}

function route() {
  const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (hash.startsWith("solve/")) return { name: "solve", id: hash.slice("solve/".length) };
  if (hash === "tracks" || hash === "wrong" || hash === "links") return { name: hash };
  return { name: "today" };
}

function markTabs() {
  const name = route().name === "solve" ? "today" : route().name;
  for (const link of document.querySelectorAll("#tabs a")) {
    const active = link.getAttribute("href") === `#${name}`;
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

function renderPhases() {
  const today = phaseState(pack.phases || []);
  phasesEl.innerHTML = (pack.phases || []).map((phase) => {
    const on = today.phase?.id === phase.id;
    const label = today.status === "current" && on ? "지금" : today.status === "upcoming" && on ? "다음" : phase.estimate ? "예상" : "일정";
    return `<article class="phase${on ? " on" : ""}"><small>${esc(label)}</small><strong>${esc(phase.title)}</strong><small>${esc(phase.start)} – ${esc(phase.end)}</small><p class="muted">${esc(phase.note)}</p></article>`;
  }).join("");
}

function statusOf(progress, id) {
  return progress[id]?.status || "";
}

function nextUnsolved(list, progress) {
  return list.find((problem) => statusOf(progress, problem.id) !== "correct") || null;
}

function countCorrect(list, progress, topicId) {
  const scoped = topicId ? list.filter((problem) => problem.topicId === topicId) : list;
  const correct = scoped.filter((problem) => statusOf(progress, problem.id) === "correct").length;
  return { correct, total: scoped.length };
}

function renderSolver(problem, progress) {
  if (!problem) {
    view.innerHTML = `<article class="card"><h2>12문항을 모두 맞혔습니다.</h2><p class="muted">트랙에서 풀이를 다시 보거나, 연결 화면에서 진도를 지울 수 있습니다.</p><div class="actions"><a class="btn" href="#tracks">트랙 보기</a></div></article>`;
    return;
  }
  const topic = topicById(problem.topicId);
  const record = progress[problem.id] || { hints: 0, checked: false, status: "" };
  const hints = Number(record.hints) || 0;
  const score = countCorrect(problems(), progress);
  view.innerHTML = `<article class="problem">
    <div class="meta"><span class="pill">${esc(topic?.area || "")}</span><span class="pill">${esc(topic?.title || "")}</span><span class="pill">난도 ${esc(LEVEL[problem.difficulty] || problem.difficulty)}</span><span class="pill">${esc(problem.minutes)}분</span><span class="pill">${score.correct}/${score.total}</span></div>
    <h2>${esc(problem.title)}</h2>
    <div class="prompt" id="prompt">${esc(problem.prompt)}</div>
    <div id="hints">${hints >= 1 ? `<div class="hint"><b>힌트 1.</b> ${esc(problem.hint1)}</div>` : ""}${hints >= 2 ? `<div class="hint"><b>힌트 2.</b> ${esc(problem.hint2)}</div>` : ""}</div>
    <form id="answer-form">
      <label class="muted" for="answer" style="position:absolute;width:1px;height:1px;overflow:hidden">답</label>
      <input id="answer" name="answer" type="text" autocomplete="off" placeholder="답만 입력. 예: 5, (2, -1), 60/13, 불가능" />
      <button type="submit">정답 확인</button>
    </form>
    <div class="actions">
      <button class="secondary" id="hint" type="button"${hints >= 2 ? " disabled" : ""}>힌트 보기</button>
      <button class="secondary" id="retry" type="button" hidden>다시</button>
      <button class="secondary" id="solution-toggle" type="button"${record.checked ? "" : " disabled"}>풀이 보기</button>
    </div>
    <div class="result" id="result" role="status"></div>
    <div class="solution" id="solution" hidden><b>풀이.</b> <span id="solution-body">${esc(problem.solution)}</span><div class="actions"><a class="btn secondary" href="/math-grader/">서술로 채점받기</a></div></div>
  </article>`;
  typeset(view);

  const form = document.querySelector("#answer-form");
  const input = document.querySelector("#answer");
  const result = document.querySelector("#result");
  const solution = document.querySelector("#solution");
  const retry = document.querySelector("#retry");
  document.querySelector("#hint").onclick = () => {
    draft = { id: problem.id, value: input.value };
    const next = loadProgress();
    const current = next[problem.id] || {};
    next[problem.id] = { ...current, hints: Math.min(2, (current.hints || 0) + 1) };
    saveProgress(next);
    render();
  };
  if (draft.id === problem.id && input) input.value = draft.value;
  input.addEventListener("input", () => {
    draft = { id: problem.id, value: input.value };
  });
  document.querySelector("#solution-toggle").onclick = () => {
    solution.hidden = !solution.hidden;
    if (!solution.hidden) typeset(solution);
  };
  retry.onclick = () => {
    draft = { id: problem.id, value: "" };
    input.value = "";
    result.textContent = "";
    result.className = "result";
    solution.hidden = true;
    retry.hidden = true;
    input.focus();
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) {
      result.textContent = "답을 입력해 주세요.";
      result.className = "result bad";
      return;
    }
    const correct = answersMatch(value, problem.answer);
    const next = loadProgress();
    next[problem.id] = { ...(next[problem.id] || {}), status: correct ? "correct" : "wrong", checked: true };
    saveProgress(next);
    document.querySelector("#solution-toggle").disabled = false;
    retry.hidden = correct;
    if (correct) {
      result.textContent = "맞았습니다.";
      result.className = "result ok";
      const following = nextUnsolved(problems(), next);
      if (following) {
        const again = document.createElement("a");
        again.className = "btn";
        again.href = "#today";
        again.textContent = "다음 문항";
        again.style.marginLeft = "8px";
        result.append(document.createTextNode(" "));
        result.append(again);
      }
    } else {
      result.textContent = "다시 생각해 보세요. 힌트를 더 열거나, 확인한 뒤에 풀이를 볼 수 있습니다.";
      result.className = "result bad";
    }
  };
}

function renderTracks(progress) {
  const list = problems();
  const areas = ["대수", "기하", "조합"];
  view.innerHTML = `<div class="areas">${areas.map((area) => {
    const topics = (pack.topics || []).filter((topic) => topic.area === area).sort((a, b) => a.order - b.order);
    const areaScore = countCorrect(list.filter((problem) => topicById(problem.topicId)?.area === area), progress);
    return `<article class="card area"><h2>${esc(area)} <span class="muted">${areaScore.correct}/${areaScore.total}</span></h2>${topics.map((topic) => {
      const score = countCorrect(list, progress, topic.id);
      const prerequisite = (topic.prerequisiteIds || []).map((id) => topicById(id)?.title).filter(Boolean).join(", ");
      const rows = list.filter((problem) => problem.topicId === topic.id).map((problem) => {
        const status = statusOf(progress, problem.id);
        const pill = status === "correct" ? "ok" : status === "wrong" ? "bad" : "";
        const label = status === "correct" ? "완료" : status === "wrong" ? "오답" : "시작";
        return `<button class="problem-row" type="button" data-id="${esc(problem.id)}"><span>${esc(problem.title)} · ${esc(LEVEL[problem.difficulty] || "")}</span><span class="pill ${pill}">${label}</span></button>`;
      }).join("");
      return `<div class="topic"><strong>${esc(topic.title)} · ${score.correct}/${score.total}</strong><p>${esc(topic.goal)}${prerequisite ? ` 선수: ${esc(prerequisite)}.` : ""}</p>${rows}</div>`;
    }).join("")}</article>`;
  }).join("")}</div>`;
  for (const button of view.querySelectorAll("[data-id]")) {
    button.onclick = () => { location.hash = `solve/${button.dataset.id}`; };
  }
}

function renderWrong(progress) {
  const wrong = problems().filter((problem) => statusOf(progress, problem.id) === "wrong");
  if (!wrong.length) {
    view.innerHTML = `<article class="card"><div class="empty">틀린 문항이 없습니다. 오늘 문항에서 틀린 답이 여기 모입니다.</div></article>`;
    return;
  }
  view.innerHTML = `<div class="areas">${wrong.map((problem) => {
    const topic = topicById(problem.topicId);
    return `<button class="problem-row" type="button" data-id="${esc(problem.id)}"><span>${esc(topic?.area || "")} · ${esc(problem.title)}</span><span class="pill bad">다시 풀기</span></button>`;
  }).join("")}</div>`;
  for (const button of view.querySelectorAll("[data-id]")) {
    button.onclick = () => { location.hash = `solve/${button.dataset.id}`; };
  }
}

function renderLinks() {
  view.innerHTML = `<div class="links">
    <a class="link-card" href="/math-grader/"><strong>서술형 AI 채점</strong><span>손글씨로 다시 쓴 풀이를 단계별로 확인합니다.</span></a>
    <a class="link-card" href="/koi-coach/"><strong>KOI Coach</strong><span>중3 영재고 지원은 5월 1차까지의 사고력 연습으로 연결합니다.</span></a>
    <a class="link-card" href="/consult/"><strong>1:1 상담</strong><span>학년과 목표 학교를 남기면 겨울 심화 반을 안내합니다.</span></a>
    <article class="card"><strong>이 브라우저의 진도</strong><p class="muted">이름과 점수는 서버로 보내지 않습니다.</p><button class="secondary" id="reset" type="button">진도 지우기</button></article>
  </div>`;
  document.querySelector("#reset").onclick = () => {
    if (!window.confirm("이 브라우저에 저장된 풀이 진도를 지울까요?")) return;
    localStorage.removeItem(STORAGE_KEY);
    location.hash = "today";
    render();
  };
}

function render() {
  if (!pack) return;
  markTabs();
  renderPhases();
  const progress = loadProgress();
  const current = route();
  if (current.name === "tracks") renderTracks(progress);
  else if (current.name === "wrong") renderWrong(progress);
  else if (current.name === "links") renderLinks();
  else if (current.name === "solve") renderSolver(problems().find((problem) => problem.id === current.id), progress);
  else renderSolver(nextUnsolved(problems(), progress), progress);
  const sourceCopy = {
    seed: "자작 문항입니다. 기출 원문은 싣지 않습니다.",
    cached: "자작 문항입니다. 기출 원문은 싣지 않습니다.",
    live: "노션에 공개된 자작 문항을 보여 줍니다.",
    error: "마지막으로 확인된 문항을 보여 줍니다.",
    setup: "공개 문항을 아직 연결하지 못했습니다.",
  };
  sourceEl.textContent = sourceCopy[pack.source?.status] || pack.source?.message || "";
}

async function init() {
  view.innerHTML = `<article class="card">문항을 불러오는 중입니다.</article>`;
  try {
    const response = await fetch(new URL("data/latest.json", import.meta.url), { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    pack = await response.json();
    addEventListener("hashchange", render);
    if (!location.hash) location.hash = "today";
    render();
  } catch (error) {
    view.innerHTML = `<article class="card"><h2>문항을 불러오지 못했습니다.</h2><p class="muted">잠시 후 다시 열어 주세요.</p></article>`;
    console.error(error);
  }
}

init();
