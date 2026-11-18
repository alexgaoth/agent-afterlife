// From sessions to an Agent Afterlife document.
//
// An adapter reads some tool's raw data and returns SESSIONS: one per agent life, in plain fields.
//
//   {
//     name:    "Marlow",                  // the name the agent went by; many sessions may share one
//     start:   "2026-01-05T09:12:00Z",    // first activity (ISO string, Date or ms)
//     end:     "2026-01-05T17:40:00Z",    // last activity
//     alive:   false,                     // optional; when absent: alive if `end` is recent
//     stats:   { commits: 4, hours: 3.1 },// totals, numbers (or short strings)
//     days:    { "2026-01-05": { commits: 4, hours: 3.1 } },  // optional, per work day
//     score, url, epitaph                 // optional, as in the schema
//   }
//
// track() builds a session from timestamped activity, so most adapters only call .at() and .count().
// toDoc() does the rest: merit (a formula over the stats), the daily series, generations, alive or ended.

export const DEFAULT_MERIT = "hours";

// ------------------------------------------------------------------ track()
/**
 * Collect one agent's activity. Active hours are the sum of the gaps between activities that are
 * at most `idleMinutes` apart, so a session left open overnight does not count as work.
 *
 *   const s = track({ name: "Marlow" });
 *   s.at(line.timestamp);                    // some activity happened
 *   s.count("commits", 1, line.timestamp);   // a counted event (also activity)
 *   s.count("cost_usd", 0.42);               // a total without a time (goes on the last day)
 *   s.set("model", "some-model");            // a string stat
 *   return s.session();                      // null if there was no activity at all
 */
export function track({ name, idleMinutes = 15, ...extra } = {}) {
  const times = [], counted = [], totals = {}, strings = {};
  return {
    at(t) { const ms = toMs(t); if (ms !== null) times.push(ms); return this; },
    count(key, n = 1, t) {
      const ms = t === undefined ? null : toMs(t);
      if (ms !== null) { times.push(ms); counted.push([ms, key, n]); } else totals[key] = (totals[key] || 0) + n;
      return this;
    },
    set(key, v) { strings[key] = v; return this; },
    get empty() { return times.length === 0; },
    session(more = {}) {
      if (!times.length) return null;
      times.sort((a, b) => a - b);
      const days = {};
      const day = (ms) => (days[dayOf(ms)] ??= {});
      day(times[0]);
      for (let i = 1; i < times.length; i++) {
        const gap = times[i] - times[i - 1];
        if (gap > 0 && gap <= idleMinutes * 6e4) { const d = day(times[i]); d.hours = (d.hours || 0) + gap / 36e5; }
        else day(times[i]);
      }
      for (const [ms, key, n] of counted) { const d = day(ms); d[key] = (d[key] || 0) + n; }
      const last = days[dayOf(times[times.length - 1])];
      for (const [k, n] of Object.entries(totals)) last[k] = (last[k] || 0) + n;
      for (const d of Object.values(days)) if (d.hours !== undefined) d.hours = round(d.hours, 2);
      return { name, ...extra, start: times[0], end: times[times.length - 1], days, stats: { ...sumDays(days), ...strings }, ...more };
    },
  };
}

// ------------------------------------------------------------------ toDoc()
/**
 * Turn sessions into a schema document.
 * opts: title, merit (formula), minMerit, metrics, aliveWithinMinutes (default 30), now, adapter, tool.
 */
export function toDoc(sessions, opts = {}) {
  const now = toMs(opts.now ?? Date.now());
  const meritOf = formula(opts.merit || DEFAULT_MERIT);
  const aliveMs = (opts.aliveWithinMinutes ?? 30) * 6e4;
  const lives = [];
  for (const s of sessions) {
    if (!s) continue;
    const start = toMs(s.start), end = toMs(s.end ?? s.start);
    if (start === null || end === null) continue;
    const days = s.days && Object.keys(s.days).length ? s.days : { [dayOf(end)]: numeric(s.stats) };
    const stats = { ...sumDays(days), ...(s.stats || {}) };
    const dayList = Object.entries(days).sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, hours: d.hours || 0, merit: Math.max(0, meritOf(d)) }));
    const merit = s.merit ?? dayList.reduce((t, d) => t + d.merit, 0);
    const alive = s.alive ?? (now - end <= aliveMs);
    lives.push({ s, start, end, stats, dayList, merit, alive });
  }

  // A day's value in the series: its merit as a percentile of every agent-day that had merit.
  const pct = percentiles(lives.flatMap((l) => l.dayList.map((d) => d.merit)).filter((m) => m > 0));
  const gen = {};
  const agents = lives.sort((a, b) => a.start - b.start || String(a.s.name).localeCompare(String(b.s.name))).map((l) => {
    const name = String(l.s.name || "Unnamed").trim() || "Unnamed";
    gen[name] = (gen[name] || 0) + 1;
    const series = l.dayList.map((d) => ({ date: d.date, value: d.merit > 0 ? pct(d.merit) : 0, ...(d.hours ? { weight: round(d.hours, 2) } : {}) }));
    const w = series.reduce((t, x) => t + (x.weight ?? 1), 0);
    const score = l.s.score ?? (series.length ? Math.round(series.reduce((t, x) => t + x.value * (x.weight ?? 1), 0) / (w || 1)) : undefined);
    const a = {
      id: `${name} #${gen[name]}`, name, generation: gen[name], status: l.alive ? "alive" : "ended",
      born: dayOf(l.start), ...(l.alive ? {} : { ended: dayOf(l.end) }),
      merit: round(l.merit, 2), ...(score !== undefined ? { score: clamp(score, 0, 100) } : {}),
      stats: tidy(l.stats), series,
    };
    for (const k of ["epitaph", "url"]) if (typeof l.s[k] === "string" && l.s[k]) a[k] = l.s[k];
    return a;
  });

  const doc = {
    schema: "agent-afterlife/1",
    ...(opts.title ? { title: opts.title } : {}),
    generated: new Date(now).toISOString(),
    source: { ...(opts.tool ? { tool: opts.tool } : {}), ...(opts.adapter ? { adapter: opts.adapter } : {}), merit: opts.merit || DEFAULT_MERIT },
    ...(opts.minMerit !== undefined ? { options: { minMerit: opts.minMerit } } : {}),
    metrics: opts.metrics || metricsFor(agents),
    agents,
  };
  return doc;
}

// ------------------------------------------------------------------ merit formulas
/**
 * Compile a merit formula over a day's stats, for example "prs_merged*5 + commits + hours/4".
 * Numbers, stat names, + - * / ( ), and min(), max(), sqrt(), log1p(). A missing stat counts as 0.
 * Nothing else runs: the formula is parsed, never eval'd.
 */
export function formula(src) {
  const tokens = String(src).match(/\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[A-Za-z_][A-Za-z0-9_]*|[-+*/(),]|\S/g) || [];
  let i = 0;
  const peek = () => tokens[i], next = () => tokens[i++];
  const expect = (t) => { if (next() !== t) throw new Error(`merit formula "${src}": expected "${t}"`); };
  const FN = { min: Math.min, max: Math.max, sqrt: (x) => Math.sqrt(Math.max(0, x)), log1p: (x) => Math.log1p(Math.max(0, x)) };
  function expr() {
    let f = term();
    while (peek() === "+" || peek() === "-") { const op = next(), a = f, b = term(); f = op === "+" ? (s) => a(s) + b(s) : (s) => a(s) - b(s); }
    return f;
  }
  function term() {
    let f = atom();
    while (peek() === "*" || peek() === "/") { const op = next(), a = f, b = atom(); f = op === "*" ? (s) => a(s) * b(s) : (s) => { const d = b(s); return d ? a(s) / d : 0; }; }
    return f;
  }
  function atom() {
    const t = next();
    if (t === undefined) throw new Error(`merit formula "${src}" ends too early`);
    if (t === "-") { const f = atom(); return (s) => -f(s); }
    if (t === "(") { const f = expr(); expect(")"); return f; }
    if (/^[\d.]/.test(t)) { const v = Number(t); return () => v; }
    if (/^[A-Za-z_]/.test(t)) {
      if (peek() === "(") {
        if (!FN[t]) throw new Error(`merit formula "${src}": unknown function ${t}()`);
        next(); const args = [expr()];
        while (peek() === ",") { next(); args.push(expr()); }
        expect(")");
        return (s) => FN[t](...args.map((a) => a(s)));
      }
      return (s) => (typeof s[t] === "number" && Number.isFinite(s[t]) ? s[t] : 0);
    }
    throw new Error(`merit formula "${src}": unexpected "${t}"`);
  }
  const f = expr();
  if (i < tokens.length) throw new Error(`merit formula "${src}": unexpected "${tokens[i]}"`);
  return f;
}

// ------------------------------------------------------------------ metrics
const LABELS = {
  merged: "PRs merged", prs_merged: "PRs merged", prs_opened: "PRs opened", prs: "PRs", commits: "Commits",
  issues: "Issues closed", edits: "File edits", commands: "Shell commands", prompts: "Prompts", tool_calls: "Tool calls",
  hours: ["Hours worked", " h"], lines_added: "Lines added", lines_removed: "Lines removed", cost_usd: ["Cost", " USD"],
  tokens: "Tokens", output_tokens: "Output tokens", messages: "Messages", tests: "Test runs", tool: "Tool", model: "Model",
};
const ORDER = Object.keys(LABELS);

/** The stats worth showing: the known ones first, in a fixed order, then the rest by how many agents have them. */
export function metricsFor(agents, max = 6) {
  const have = {};
  for (const a of agents) for (const [k, v] of Object.entries(a.stats || {})) if (v) have[k] = (have[k] || 0) + 1;
  return Object.keys(have)
    .sort((a, b) => (rank(a) - rank(b)) || have[b] - have[a] || a.localeCompare(b))
    .slice(0, max)
    .map((key) => {
      const l = LABELS[key];
      const [label, unit] = Array.isArray(l) ? l : [l || key.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase())];
      return { key, label, ...(unit ? { unit } : {}) };
    });
}
const rank = (k) => (ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length);

// ------------------------------------------------------------------ anonymise
const ADJ = ["Amber", "Ashen", "Autumn", "Bright", "Calm", "Cedar", "Copper", "Dawn", "Dusk", "Ember", "Faint", "Frost", "Gilded", "Hollow", "Iron", "Ivory", "Jade", "Lone", "Misty", "Moss", "Night", "Pale", "Quiet", "Rain", "Rust", "Salt", "Silver", "Slate", "Still", "Swift", "Tidal", "Willow"];
const NOUN = ["Heron", "Lantern", "Comet", "Fox", "Harbor", "Juniper", "Kestrel", "Ledger", "Magpie", "Marten", "Meadow", "Otter", "Owl", "Pine", "Quill", "Raven", "Reed", "River", "Robin", "Sparrow", "Stone", "Thistle", "Wren", "Yarrow", "Badger", "Beacon", "Bramble", "Cinder", "Falcon", "Grove", "Lark", "Moth"];

/** Give every name a stable made-up one ("Quiet Heron"), and drop urls and epitaphs, before you publish. */
export function anonymise(sessions) {
  const map = new Map(), used = new Set();
  const alias = (name) => {
    if (map.has(name)) return map.get(name);
    let h = hash(name), a;
    do { a = `${ADJ[h % 32]} ${NOUN[(h >>> 5) % 32]}`; h = (h * 2654435761 + 1) >>> 0; } while (used.has(a) && used.size < 1024);
    used.add(a); map.set(name, a);
    return a;
  };
  return sessions.filter(Boolean).map(({ url, epitaph, ...s }) => ({ ...s, name: alias(String(s.name || "Unnamed")) }));
}

// ------------------------------------------------------------------ helpers
/** The local calendar day of a time, as YYYY-MM-DD (set TZ to change the time zone). */
export function dayOf(t) {
  const d = new Date(toMs(t));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function toMs(t) {
  if (t === null || t === undefined || t === "") return null;
  if (typeof t === "number") return Number.isFinite(t) ? (t < 1e11 ? t * 1000 : t) : null;  // seconds or ms
  const ms = t instanceof Date ? t.getTime() : Date.parse(t);
  return Number.isNaN(ms) ? null : ms;
}
function sumDays(days) {
  const out = {};
  for (const d of Object.values(days)) for (const [k, v] of Object.entries(d)) if (typeof v === "number") out[k] = (out[k] || 0) + v;
  return out;
}
function numeric(stats = {}) { return Object.fromEntries(Object.entries(stats).filter(([, v]) => typeof v === "number")); }
function tidy(stats) {
  const out = {};
  for (const [k, v] of Object.entries(stats)) {
    // Small numbers keep two decimals, so a one-minute session shows 0.02 h, not 0.
    if (typeof v === "number" && Number.isFinite(v)) out[k] = Number.isInteger(v) ? v : round(v, k === "cost_usd" || Math.abs(v) < 1 ? 2 : 1);
    else if (typeof v === "string" && v) out[k] = v.slice(0, 80);
  }
  return out;
}
function percentiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return (v) => {
    if (!sorted.length) return 0;
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
    let top = lo;
    while (top < sorted.length && sorted[top] === v) top++;
    return clamp(Math.round(((lo + top) / 2 / sorted.length) * 100), 1, 100);
  };
}
function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0; return h; }
const round = (x, n) => Math.round(x * 10 ** n) / 10 ** n;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
