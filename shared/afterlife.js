// Shared data layer for both settings. It knows the schema (schema/afterlife.schema.json),
// not where the data comes from: a page asks for loadData() and gets a checked document.
//
//   ?data=<url>                          load any JSON document that follows the schema
//   <meta name="afterlife-data" content> the page's own data source, when there is no ?data
//   ?demo, or neither of the above       a seeded demo fleet, generated here, the same on every load
//
// This file also runs in Node (the CLI imports validate() and demo()), so it touches the DOM only in loadData().

export const SCHEMA = "agent-afterlife/1";

// ------------------------------------------------------------------ embedding
// ?embed=1: the page runs inside another page's <iframe> (see shared/embed.js). It hides its links back to this
// site, can take its data from the parent by postMessage, tells the parent what the visitor opens, and opens
// an agent when the parent asks. Messages: { type: "agent-afterlife:<ready|loaded|select|data|open>", ... }.
const inBrowser = typeof window !== "undefined" && typeof location !== "undefined";
export const embedded = inBrowser && new URLSearchParams(location.search).has("embed") && window.parent !== window;
if (embedded) document.documentElement.classList.add("embed");

/** Tell the parent page something (embedded pages only). */
export function notify(type, detail = {}) {
  if (embedded) window.parent.postMessage({ type: `agent-afterlife:${type}`, ...detail }, "*");
}

/** Call handler(id) when the parent page asks to open an agent: postMessage({ type: "agent-afterlife:open", id }). */
export function onOpenRequest(handler) {
  if (!embedded) return;
  window.addEventListener("message", (e) => {
    if (e.source === window.parent && e.data?.type === "agent-afterlife:open" && typeof e.data.id === "string") handler(e.data.id);
  });
}

/** Wait up to `ms` for the parent to send { type: "agent-afterlife:data", doc }. */
function fromParent(ms) {
  return new Promise((resolve) => {
    const done = (doc) => { window.removeEventListener("message", on); clearTimeout(timer); resolve(doc); };
    const on = (e) => { if (e.source === window.parent && e.data?.type === "agent-afterlife:data") done(e.data.doc); };
    const timer = setTimeout(() => done(null), ms);
    window.addEventListener("message", on);
    notify("ready");
  });
}
const DEFAULT_MIN_MERIT = 0.1;

/** Load the document named by ?data=, or the demo. Returns { data, errors, source }. */
export async function loadData(search = location.search) {
  const got = await load(search);
  if (got.data) notify("loaded", { agents: got.data.agents.length, source: got.source });
  return got;
}

async function load(search) {
  const q = new URLSearchParams(search);
  if (embedded && !q.get("data") && !q.has("demo")) {
    const doc = await fromParent(4000);
    if (doc) {
      const errors = validate(doc);
      return { data: errors.length ? null : normalise(doc), errors, source: "parent" };
    }
  }
  const given = q.has("demo") ? null
    : q.get("data") || (typeof document !== "undefined" && document.querySelector('meta[name="afterlife-data"]')?.content);
  if (!given) return { data: demo(), errors: [], source: "demo" };
  // A relative ?data= is relative to the site root, whichever setting's page is reading it.
  const url = new URL(given, new URL("../", import.meta.url)).href;
  let doc;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { data: null, errors: [`Could not load ${url}: HTTP ${res.status}.`], source: url };
    doc = await res.json();
  } catch (e) {
    return { data: null, errors: [`Could not load ${url}: ${e.message}.`], source: url };
  }
  const errors = validate(doc);
  return { data: errors.length ? null : normalise(doc), errors, source: url };
}

/** Check a document against schema/afterlife.schema.json. Returns readable problems (empty = valid). */
export function validate(doc) {
  const p = [];
  if (!isObj(doc)) return ["The document is not a JSON object."];
  unknown(doc, TOP, "The document", p);
  if (doc.schema !== SCHEMA) p.push(`"schema" must be "${SCHEMA}".`);
  str(doc, "title", "The document", p);
  if (doc.generated !== undefined && (typeof doc.generated !== "string" || isNaN(Date.parse(doc.generated))))
    p.push('"generated" must be a date-time, for example "2026-01-26T08:00:00Z".');
  if (doc.options !== undefined) {
    if (!isObj(doc.options)) p.push('"options" must be an object.');
    else {
      unknown(doc.options, ["minMerit"], "options", p);
      if (doc.options.minMerit !== undefined && !(num(doc.options.minMerit) && doc.options.minMerit >= 0)) p.push("options.minMerit must be a number of 0 or more.");
    }
  }
  if (doc.source !== undefined) {
    if (!isObj(doc.source)) p.push('"source" must be an object.');
    else { unknown(doc.source, SOURCE, "source", p); for (const k of SOURCE) str(doc.source, k, "source", p); }
  }
  if (doc.metrics !== undefined) {
    if (!Array.isArray(doc.metrics)) p.push('"metrics" must be an array.');
    else doc.metrics.forEach((m, i) => {
      const at = `metrics[${i}]`;
      if (!isObj(m)) { p.push(`${at} is not an object.`); return; }
      unknown(m, ["key", "label", "unit"], at, p);
      for (const k of ["key", "label"]) if (typeof m[k] !== "string") p.push(`${at} needs a string "${k}".`);
      str(m, "unit", at, p);
    });
  }
  if (!Array.isArray(doc.agents)) p.push('"agents" must be an array.');
  else {
    const ids = new Set();
    doc.agents.forEach((a, i) => agent(a, `agents[${i}]${isObj(a) && typeof a.id === "string" ? ` (${a.id})` : ""}`, ids, p));
  }
  if (doc.edicts !== undefined) {
    if (!Array.isArray(doc.edicts)) p.push('"edicts" must be an array.');
    else doc.edicts.forEach((e, i) => {
      const at = `edicts[${i}]`;
      if (!isObj(e)) { p.push(`${at} is not an object.`); return; }
      unknown(e, ["date", "items"], at, p);
      if (typeof e.date !== "string" || isNaN(Date.parse(e.date))) p.push(`${at} needs a date-time "date".`);
      if (!Array.isArray(e.items)) { p.push(`${at} needs an array "items".`); return; }
      e.items.forEach((it, j) => {
        const iat = `${at}.items[${j}]`;
        if (!isObj(it)) { p.push(`${iat} is not an object.`); return; }
        unknown(it, ["kind", "agent", "from", "to", "count"], iat, p);
        if (!KINDS.includes(it.kind)) p.push(`${iat}: kind must be one of ${KINDS.join(", ")}.`);
        str(it, "agent", iat, p);
        for (const k of ["from", "to"]) if (it[k] !== undefined && !GROUPS.includes(it[k])) p.push(`${iat}: ${k} must be one of ${GROUPS.join(", ")}.`);
        if (it.count !== undefined && !(Number.isInteger(it.count) && it.count >= 0)) p.push(`${iat}: count must be a whole number of 0 or more.`);
      });
    });
  }
  return p.length > MAX_PROBLEMS ? [...p.slice(0, MAX_PROBLEMS), `...and ${p.length - MAX_PROBLEMS} more problems.`] : p;
}

const TOP = ["$schema", "schema", "title", "generated", "options", "source", "metrics", "agents", "edicts"];
const SOURCE = ["tool", "adapter", "merit", "url"];
const AGENT = ["id", "name", "generation", "status", "born", "ended", "merit", "score", "stats", "series", "epitaph", "url"];
const KINDS = ["founded", "enshrined", "promoted", "demoted", "removed"];
const GROUPS = ["main", "companion", "hall", "wings", "outside"];
const DATE = /^\d{4}-\d{2}-\d{2}/;
const MAX_PROBLEMS = 40;
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const num = (x) => typeof x === "number" && Number.isFinite(x);
function unknown(o, allowed, at, p) { for (const k of Object.keys(o)) if (!allowed.includes(k)) p.push(`${at} has an unknown field "${k}".`); }
function str(o, k, at, p) { if (o[k] !== undefined && typeof o[k] !== "string") p.push(`${at}: ${k} must be a string.`); }

function agent(a, at, ids, p) {
  if (!isObj(a)) { p.push(`${at} is not an object.`); return; }
  unknown(a, AGENT, at, p);
  for (const k of ["id", "name", "status", "born", "merit"]) if (a[k] === undefined) p.push(`${at} has no "${k}".`);
  for (const k of ["id", "name", "epitaph", "url"]) str(a, k, at, p);
  if (typeof a.id === "string") { if (ids.has(a.id)) p.push(`${at}: id is used twice.`); ids.add(a.id); }
  if (a.generation !== undefined && !(Number.isInteger(a.generation) && a.generation >= 1)) p.push(`${at}: generation must be a whole number of 1 or more.`);
  if (a.status !== undefined && !["ended", "alive"].includes(a.status)) p.push(`${at}: status must be "ended" or "alive".`);
  if (a.status === "ended" && a.ended === undefined) p.push(`${at}: an ended agent needs "ended".`);
  for (const k of ["born", "ended"]) if (a[k] !== undefined && !(typeof a[k] === "string" && DATE.test(a[k]))) p.push(`${at}: ${k} must start YYYY-MM-DD.`);
  if (typeof a.born === "string" && typeof a.ended === "string" && a.ended.slice(0, 10) < a.born.slice(0, 10)) p.push(`${at}: ended is before born.`);
  if (a.merit !== undefined && !(num(a.merit) && a.merit >= 0)) p.push(`${at}: merit must be a number of 0 or more.`);
  if (a.score !== undefined && !(num(a.score) && a.score >= 0 && a.score <= 100)) p.push(`${at}: score must be a number from 0 to 100.`);
  if (a.stats !== undefined) {
    if (!isObj(a.stats)) p.push(`${at}: stats must be an object.`);
    else for (const [k, v] of Object.entries(a.stats)) if (!num(v) && typeof v !== "string") p.push(`${at}: stats.${k} must be a number or a string.`);
  }
  if (a.series !== undefined) {
    if (!Array.isArray(a.series)) { p.push(`${at}: series must be an array.`); return; }
    a.series.forEach((s, j) => {
      const sat = `${at}.series[${j}]`;
      if (!isObj(s)) { p.push(`${sat} is not an object.`); return; }
      unknown(s, ["date", "value", "weight"], sat, p);
      if (!(typeof s.date === "string" && DATE.test(s.date))) p.push(`${sat}: date must start YYYY-MM-DD.`);
      if (!(num(s.value) && s.value >= 0 && s.value <= 100)) p.push(`${sat}: value must be a number from 0 to 100.`);
      if (s.weight !== undefined && !(num(s.weight) && s.weight >= 0)) p.push(`${sat}: weight must be a number of 0 or more.`);
    });
  }
}

/** Fill defaults the pages rely on. Does not change the meaning of the data. */
function normalise(doc) {
  const minMerit = doc.options?.minMerit ?? DEFAULT_MIN_MERIT;
  const gen = {};
  const agents = [...doc.agents]
    .sort((a, b) => a.born.localeCompare(b.born) || a.id.localeCompare(b.id))
    .map((a) => {
      gen[a.name] = (gen[a.name] || 0) + 1;
      return { stats: {}, series: [], ...a, generation: a.generation ?? gen[a.name] };
    });
  return { title: "", metrics: [], edicts: [], ...doc, options: { minMerit }, agents };
}

/** Ended agents with merit at or above minMerit, best first. Ties break by id, so the order is stable. */
export function ranked(data) {
  return data.agents
    .filter((a) => a.status === "ended" && a.merit >= data.options.minMerit)
    .sort((a, b) => b.merit - a.merit || a.id.localeCompare(b.id));
}

export const living = (data) => data.agents.filter((a) => a.status === "alive");
export const passersBy = (data) => data.agents.filter((a) => a.status === "ended" && a.merit < data.options.minMerit);

/** The agent's own epitaph, or one written from its stats. */
export function epitaph(a, metrics = []) {
  if (a.epitaph) return a.epitaph;
  const days = new Set(a.series.map((s) => s.date)).size;
  const top = metrics.map((m) => [m, a.stats[m.key]]).find(([, v]) => typeof v === "number" && v >= 10);
  if (top) return `${top[0].label}: ${top[1]}. It is remembered.`;
  if (days >= 4) return `Served ${days} days without rest.`;
  if (a.merit < 0.1) return "Came, looked around, and left.";
  return "Read much, wrote little, asked good questions.";
}

/** Shown stats: the document's metrics, in order, with values this agent has. */
export function shownStats(a, metrics) {
  return metrics.filter((m) => a.stats[m.key] !== undefined)
    .map((m) => ({ label: m.label, value: `${a.stats[m.key]}${m.unit || ""}` }));
}

// ------------------------------------------------------------------ demo fleet
// A deterministic generator (mulberry32), so the demo is the same on every load.
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEMO_NAMES = ["Marlow", "Tamsin", "Corwin", "Isolde", "Ansel", "Briar", "Odile", "Fenwick", "Rosalind", "Thaddeus", "Wren", "Ottoline", "Caspian", "Hester", "Lucan", "Sabine"];

/** A made-up fleet of 90 agents over three weeks. No real data. */
export function demo(seed = 1123) {
  const r = rng(seed);
  const start = Date.UTC(2026, 0, 5);
  const day = (n) => new Date(start + n * 864e5).toISOString().slice(0, 10);
  const agents = [];
  for (let i = 0; i < 90; i++) {
    const name = r() < 0.12 ? "Unnamed" : DEMO_NAMES[Math.floor(r() * DEMO_NAMES.length)];
    const first = Math.floor((i / 90) * 20);
    const span = [1, 1, 1, 2, 2, 3, 4, 5][Math.floor(r() * 8)];
    const busy = r() ** 2;                     // most agents are brief; a few carry the work
    const series = [];
    let merit = 0, merged = 0, issues = 0, hours = 0;
    for (let d = 0; d < span && first + d < 21; d++) {
      const h = +(0.05 + busy * (1 + r() * 8)).toFixed(2);
      const v = Math.round(Math.min(98, Math.max(5, 35 + 50 * busy + (r() - 0.5) * 20)));
      series.push({ date: day(first + d), value: v, weight: h });
      merit += (v / 100) * h; hours += h;
      merged += Math.floor(busy * r() * 12); issues += Math.floor(busy * r() * 6);
    }
    const alive = i >= 82;                    // the newest eight are still running
    agents.push({
      id: `${name}-${i}`, name, status: alive ? "alive" : "ended",
      born: series[0].date, ...(alive ? {} : { ended: series[series.length - 1].date }),
      merit: +merit.toFixed(2),
      score: Math.round(series.reduce((s, x) => s + x.value * x.weight, 0) / hours),
      stats: { merged, issues, hours: +hours.toFixed(1) }, series,
    });
  }
  // Ids in the "Name #n" form, numbered per name in order of birth.
  const gen = {};
  for (const a of agents) { gen[a.name] = (gen[a.name] || 0) + 1; a.id = `${a.name} #${gen[a.name]}`; a.generation = gen[a.name]; }
  const doc = {
    schema: SCHEMA, title: "A demo fleet", generated: new Date(start + 21 * 864e5).toISOString(),
    metrics: [{ key: "merged", label: "PRs merged" }, { key: "issues", label: "Issues closed" }, { key: "hours", label: "Hours worked", unit: " h" }],
    agents,
    edicts: [{ date: day(20) + "T08:00:00Z", items: [{ kind: "enshrined", agent: agents[70].id, to: "wings" }, { kind: "promoted", agent: agents[52].id, from: "wings", to: "hall" }] }],
  };
  return normalise(doc);
}
