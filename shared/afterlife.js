// Shared data layer for both settings. It knows the schema (schema/afterlife.schema.json),
// not where the data comes from: a page asks for loadData() and gets a checked document.
//
//   ?data=<url>   load any JSON document that follows the schema
//   (no ?data)    a seeded demo fleet, generated here, the same on every load

export const SCHEMA = "agent-afterlife/1";
const DEFAULT_MIN_MERIT = 0.1;

/** Load the document named by ?data=, or the demo. Returns { data, errors, source }. */
export async function loadData(search = location.search) {
  const url = new URLSearchParams(search).get("data");
  if (!url) return { data: demo(), errors: [], source: "demo" };
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

/** Check a document against the schema's rules. Returns a list of readable problems (empty = valid). */
export function validate(doc) {
  const p = [];
  if (!doc || typeof doc !== "object") return ["The document is not a JSON object."];
  if (doc.schema !== SCHEMA) p.push(`"schema" must be "${SCHEMA}".`);
  if (!Array.isArray(doc.agents)) return [...p, '"agents" must be an array.'];
  const ids = new Set();
  doc.agents.forEach((a, i) => {
    const at = `agents[${i}]${a && a.id ? ` (${a.id})` : ""}`;
    if (!a || typeof a !== "object") { p.push(`${at} is not an object.`); return; }
    for (const k of ["id", "name", "status", "born", "merit"]) if (a[k] === undefined) p.push(`${at} has no "${k}".`);
    if (a.id !== undefined) { if (ids.has(a.id)) p.push(`${at}: id is used twice.`); ids.add(a.id); }
    if (a.status !== undefined && !["ended", "alive"].includes(a.status)) p.push(`${at}: status must be "ended" or "alive".`);
    if (a.status === "ended" && !a.ended) p.push(`${at}: an ended agent needs "ended".`);
    if (a.merit !== undefined && !(typeof a.merit === "number" && a.merit >= 0)) p.push(`${at}: merit must be a number of 0 or more.`);
    for (const k of ["born", "ended"]) if (a[k] && !/^\d{4}-\d{2}-\d{2}/.test(a[k])) p.push(`${at}: ${k} must start YYYY-MM-DD.`);
    if (a.series && !Array.isArray(a.series)) p.push(`${at}: series must be an array.`);
  });
  if (doc.metrics && !Array.isArray(doc.metrics)) p.push('"metrics" must be an array.');
  return p;
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
