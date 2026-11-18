// The text version: the same document as the temple and the graveyard, as plain, navigable HTML for screen readers,
// keyboards, and browsers without WebGL. Headings for each part, a real table for the enshrined, the same findings.
import { loadData, ranked, living, passersBy, shownStats } from "../shared/afterlife.js";
import { insights } from "../shared/insights.js";
import { seat, ZONES } from "../temple/seating.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const SHOW = 300;
const ord = (n) => { const t = n % 100; return n + (t >= 11 && t <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] || "th"); };                                   // rows of the enshrined table before "show all"

const { data, errors, source } = await loadData();
// Keep the same data when moving to the other views.
const q = new URLSearchParams(location.search);
for (const id of ["to-temple", "to-graveyard"]) {
  const u = new URL($(id).href);
  for (const k of ["data", "demo"]) if (q.has(k)) u.searchParams.set(k, q.get(k));
  $(id).href = u.href;
}

if (!data) {
  $("lead").textContent = "The data could not be shown.";
  $("body").innerHTML = `<div class="error" role="alert"><p>The document does not follow the schema:</p><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>`;
} else {
  const R = ranked(data), L = living(data), P = passersBy(data);
  const { placement } = seat(R);
  const title = data.title || "Agent Afterlife";
  document.title = `${title}: text version`;
  $("title").textContent = title;
  $("lead").textContent = `${R.length} agents rest with merit, ${P.length} passed through, ${L.length} still working.${source === "demo" ? " This is a made-up demo fleet." : ""}`;
  const where = (a) => {
    const p = placement.get(a.id);
    if (!p) return "";
    if (p.zone === "outside") return "Waits outside the gate (every seat is taken)";
    return `${ZONES[p.zone].en}, seat ${p.no}, in the seat of <span lang="zh">${esc(p.orig)}</span>`;
  };
  const metrics = (data.metrics || []);
  const row = (a, i) => `<tr><td class="n">${i + 1}</td><th scope="row">${esc(a.name)}${a.generation > 1 ? ` <span class="gen">(${ord(a.generation)} of the name)</span>` : ""}</th>
    <td>${where(a)}</td><td class="n">${a.merit}</td><td>${esc(a.born)}${a.ended ? ` to ${esc(a.ended)}` : ""}</td>
    <td>${shownStats(a, metrics).map((s) => `${esc(s.label)}: ${esc(s.value)}`).join("; ")}</td></tr>`;
  const table = (list, limit) => `<table><caption>Best first. Merit decides the seat; seats follow the temple of 1123.</caption>
    <thead><tr><th scope="col" class="n">Rank</th><th scope="col">Name</th><th scope="col">Seat in the temple</th><th scope="col" class="n">Merit</th><th scope="col">Worked</th><th scope="col">Record</th></tr></thead>
    <tbody>${list.slice(0, limit).map(row).join("")}</tbody></table>`;
  const found = insights(data);
  $("body").innerHTML = `
    <h2 id="numbers">What the numbers say</h2>
    ${found.map((i) => `<h3><span lang="zh">${esc(i.cn)}</span> ${esc(i.title)}</h3><p>${esc(i.finding)}</p>`).join("")}
    <h2 id="enshrined">The enshrined and the ranked (${R.length})</h2>
    <div id="table">${table(R, SHOW)}</div>
    ${R.length > SHOW ? `<p><button type="button" id="all">Show all ${R.length} rows</button></p>` : ""}
    <h2 id="living">Still working (${L.length})</h2>
    ${L.length ? `<ul>${L.map((a) => `<li>${esc(a.name)}${a.generation > 1 ? ` (generation ${a.generation})` : ""}, since ${esc(a.born)}</li>`).join("")}</ul>` : "<p>None.</p>"}
    <h2 id="passers">Passers-by (${P.length})</h2>
    <p>Agents whose merit stayed under ${data.options.minMerit}. They rest in unmarked graves and have no seat in the temple.</p>`;
  $("all")?.addEventListener("click", (e) => { $("table").innerHTML = table(R, R.length); e.target.remove(); });
}
