// Statistical insights about a fleet, computed only from the schema (agents, merit, born, ended,
// score, series). Any data source gets them. Each insight says how many agents it rests on and
// declines to conclude when there are too few.
//
//   concentration  how unevenly merit is shared (top-10% share, Gini, Lorenz curve)
//   chronicle      merit, births and deaths per day
//   longevity      merit per day of work, by how long agents lived
//   lineage        merit by generation of a reused name
//   quality        how scores spread, and whether score goes with merit (Spearman)

const MIN_N = 5;

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const pct = (x) => `${Math.round(x * 100)}%`;
/** Days an agent worked: distinct series dates, else born..ended inclusive. */
export function daysServed(a) {
  const n = new Set((a.series || []).map((s) => s.date)).size;
  if (n) return n;
  if (!a.ended) return 1;
  return Math.max(1, Math.round((Date.parse(a.ended) - Date.parse(a.born)) / 864e5) + 1);
}
function ranks(xs) {
  const order = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2 + 1;   // ties share the mean rank
    i = j + 1;
  }
  return r;
}
/** Spearman rank correlation of two equal-length lists. */
export function spearman(xs, ys) {
  const rx = ranks(xs), ry = ranks(ys), n = xs.length;
  const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

const ended = (data) => data.agents.filter((a) => a.status === "ended");
// Statistics cover agents that did real work; passers-by (merit under options.minMerit) are counted apart,
// or a crowd of one-off sessions would decide every median.
const worked = (data) => ended(data).filter((a) => a.merit >= (data.options?.minMerit ?? 0.1));
const tooFew = (key, cn, title, n) => ({ key, cn, title, n, finding: `Too few agents to tell yet (${n}).`, chart: null });

export function concentration(data) {
  const merits = worked(data).map((a) => a.merit).sort((a, b) => b - a);
  const passers = ended(data).length - merits.length;
  const n = merits.length, total = merits.reduce((s, x) => s + x, 0);
  if (n < MIN_N || !total) return tooFew("concentration", "功德", "Who carried the work", n);
  const top = Math.max(1, Math.ceil(n * 0.1));
  const topShare = merits.slice(0, top).reduce((s, x) => s + x, 0) / total;
  let acc = 0, half = 0;
  for (const m of merits) { acc += m; half++; if (acc >= total / 2) break; }
  const asc = [...merits].reverse();
  let cum = 0, gini = 0;
  const lorenz = [[0, 0]];
  asc.forEach((m, i) => { cum += m; lorenz.push([(i + 1) / n, cum / total]); gini += (2 * (i + 1) - n - 1) * m; });
  gini /= n * total;
  return {
    key: "concentration", cn: "功德", title: "Who carried the work", n,
    finding: `Of the ${n} agents that did real work, the top 10% (${top}) earned ${pct(topShare)} of all merit; half of it came from ${half} agents. Gini ${round(gini, 2)}.` +
      (passers ? ` Another ${passers} sessions were passers-by and did almost nothing.` : ""),
    stats: { topShare, half, gini, passers },
    chart: { kind: "lorenz", points: lorenz },
  };
}

export function chronicle(data) {
  const days = new Map();
  const day = (d) => { if (!days.has(d)) days.set(d, { date: d, merit: 0, active: 0, born: 0, ended: 0 }); return days.get(d); };
  for (const a of data.agents) {
    for (const s of a.series || []) { const e = day(s.date); e.merit += (s.value / 100) * (s.weight ?? 1); e.active++; }
    day(a.born.slice(0, 10)).born++;
    if (a.ended) day(a.ended.slice(0, 10)).ended++;
  }
  const rows = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 3) return tooFew("chronicle", "年表", "The fleet day by day", rows.length);
  const best = rows.reduce((b, r) => (r.merit > b.merit ? r : b), rows[0]);
  const third = Math.max(1, Math.floor(rows.length / 3));
  const avg = (rs) => rs.reduce((s, r) => s + r.merit, 0) / rs.length;
  const early = avg(rows.slice(0, third)), late = avg(rows.slice(-third));
  const trend = late > early * 1.15 ? "rising" : late < early * 0.85 ? "falling" : "steady";
  return {
    key: "chronicle", cn: "年表", title: "The fleet day by day", n: rows.length,
    finding: `Busiest day ${best.date}: ${round(best.merit)} merit from ${best.active} agents. Output is ${trend}: the last third of days averaged ${round(late)} a day against ${round(early)} in the first.`,
    stats: { best, trend, early, late },
    chart: { kind: "days", rows: rows.map((r) => ({ ...r, merit: round(r.merit, 2) })) },
  };
}

export function longevity(data) {
  const groups = { "1 day": [], "2 days": [], "3+ days": [] };
  for (const a of worked(data)) {
    const d = daysServed(a);
    groups[d === 1 ? "1 day" : d === 2 ? "2 days" : "3+ days"].push(a.merit / d);
  }
  const rows = Object.entries(groups).map(([label, xs]) => ({ label, n: xs.length, median: round(median(xs), 2) }));
  const short = rows[0], long = rows[2];
  const n = rows.reduce((s, r) => s + r.n, 0);
  if (short.n < 3 || long.n < 3) return { ...tooFew("longevity", "寿", "Does a longer life pay", n), chart: { kind: "bars", rows } };
  const ratio = short.median ? long.median / short.median : null;
  return {
    key: "longevity", cn: "寿", title: "Does a longer life pay", n,
    finding: ratio == null ? `Agents that served 3 days or more earned a median ${long.median} merit a day (n ${long.n}).`
      : `Agents that served 3 days or more earned ${ratio > 0.85 && ratio < 1.15 ? "about the same merit per day as" : `${round(ratio)}× the merit per day of`} one-day agents (median ${long.median} against ${short.median}; n ${long.n} and ${short.n}). Cause may run either way: good agents are the ones kept alive.`,
    stats: { ratio },
    chart: { kind: "bars", unit: "median merit a day", rows },
  };
}

export function lineage(data) {
  const groups = { "1st": [], "2nd": [], "3rd": [], "4th+": [] };
  for (const a of worked(data)) {
    if (a.name === "Unnamed") continue;                       // numbering of nameless agents means nothing
    const g = a.generation || 1;
    groups[g === 1 ? "1st" : g === 2 ? "2nd" : g === 3 ? "3rd" : "4th+"].push(a.merit);
  }
  const rows = Object.entries(groups).map(([label, xs]) => ({ label, n: xs.length, median: round(median(xs), 2) }));
  const first = rows[0], later = [].concat(groups["2nd"], groups["3rd"], groups["4th+"]);
  const n = first.n + later.length;
  if (first.n < 3 || later.length < 3) return { ...tooFew("lineage", "世系", "Do names carry luck", n), chart: { kind: "bars", rows } };
  const mLater = round(median(later), 2);
  return {
    key: "lineage", cn: "世系", title: "Do names carry luck", n,
    finding: `First bearers of a name earned a median ${first.median} merit; agents reusing a name earned ${mLater} (n ${first.n} and ${later.length}). A name is a label, so read this as chance unless the gap is large.`,
    stats: { first: first.median, later: mLater },
    chart: { kind: "bars", unit: "median merit", rows },
  };
}

export function quality(data) {
  const scored = worked(data).filter((a) => typeof a.score === "number");
  const n = scored.length;
  if (n < MIN_N) return tooFew("quality", "品", "How good was the work", n);
  const bins = Array.from({ length: 10 }, (_, i) => ({ label: `${i * 10}`, n: 0 }));
  for (const a of scored) bins[Math.min(9, Math.floor(a.score / 10))].n++;
  const rho = spearman(scored.map((a) => a.score), scored.map((a) => a.merit));
  const mid = median(scored.map((a) => a.score));
  const strength = Math.abs(rho) >= 0.5 ? "strongly" : Math.abs(rho) >= 0.3 ? "moderately" : "barely";
  return {
    key: "quality", cn: "品", title: "How good was the work", n,
    finding: `The median agent scored ${round(mid)}. Score and merit are ${strength} related (Spearman ρ ${round(rho, 2)}, n ${n}): ${Math.abs(rho) >= 0.3 ? "better work and more work tend to go together" : "how much an agent did says little about how well"}.`,
    stats: { rho, median: mid },
    chart: { kind: "histogram", rows: bins },
  };
}

/** All insights, in the order the temple's steles stand. */
export function insights(data) {
  return [concentration(data), chronicle(data), longevity(data), lineage(data), quality(data)];
}

/** Per-agent marks the statues show: gilded (top 10% by merit), days served, merit percentile. */
export function honours(data) {
  const e = worked(data).sort((a, b) => b.merit - a.merit);
  const top = Math.max(1, Math.ceil(e.length * 0.1));
  const out = new Map();
  e.forEach((a, i) => out.set(a.id, { gilded: i < top, days: daysServed(a), percentile: e.length > 1 ? 1 - i / (e.length - 1) : 1 }));
  return out;
}
