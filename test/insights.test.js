import { test } from "node:test";
import assert from "node:assert/strict";
import { survival, insights, trend, rhythm, records, holderOn } from "../shared/insights.js";
import { demo } from "../shared/afterlife.js";

const agent = (born, ended, alive = false) => ({ id: `${born}-${ended}-${Math.random()}`, name: "x", status: alive ? "alive" : "ended", born, ...(alive ? {} : { ended }), merit: 1 });
const doc = (agents) => ({ generated: "2026-01-10T00:00:00Z", options: { minMerit: 0.1 }, agents });

test("survival: Kaplan-Meier with agents still working counted as far as they got", () => {
  // Ended after 1, 1, 2, 3 days; one alive for 2 days so far (censored at day 2); one alive for 5 days.
  const s = survival(doc([agent("2026-01-01", "2026-01-01"), agent("2026-01-02", "2026-01-02"), agent("2026-01-03", "2026-01-04"),
    agent("2026-01-04", "2026-01-06"), agent("2026-01-09", null, true), agent("2026-01-06", null, true)]));
  // day 1: 6 at risk, 2 end -> 4/6; day 2: 4 at risk, 1 ends -> 4/6*3/4 = 0.5; day 3: 2 at risk (the censored day-2 one left), 1 ends -> 0.25
  assert.deepEqual(s.chart.rows.slice(0, 5).map((r) => r.s), [0.6667, 0.5, 0.25, 0.25, 0.25]);
  assert.equal(s.stats.median, 2);
  assert.match(s.finding, /Half of the working agents had ended within 2 days/);
  assert.match(s.finding, /2 still working/);
  assert.equal(s.n, 6);
});

test("survival: too few agents, and on the demo fleet", () => {
  assert.match(survival(doc([agent("2026-01-01", "2026-01-01")])).finding, /Too few/);
  const d = demo();
  const s = survival(d);
  assert.ok(s.chart.rows.every((r, i, a) => r.s >= 0 && r.s <= 1 && (i === 0 || r.s <= a[i - 1].s)));   // never rises
  assert.deepEqual(insights(d).map((i) => i.key), ["concentration", "survival", "chronicle", "longevity", "lineage", "quality", "trend", "rhythm"]);
});

test("trend: later agents earning more per day shows as a rising median and a positive rho", () => {
  const agents = Array.from({ length: 24 }, (_, i) => {
    const born = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    return { id: `a${i}`, name: "x", status: "ended", born, ended: born, merit: 1 + i, series: [{ date: born, value: 50 }] };
  });
  const t = trend(doc(agents));
  assert.ok(t.stats.rho > 0.9);
  assert.equal(t.chart.rows.length, 3);
  assert.ok(t.chart.rows[0].median < t.chart.rows[2].median);
  assert.match(t.finding, /Agents started later earn more merit a day/);
  assert.match(trend(doc(agents.slice(0, 5))).finding, /Too few/);
});

test("rhythm: weekday shares add up and name the busiest day", () => {
  // Four weeks, merit only on Tuesdays (2026-01-06 is a Tuesday) except a little on one Saturday.
  const agents = [];
  for (let d = 0; d < 28; d++) {
    const date = new Date(Date.UTC(2026, 0, 5 + d)).toISOString().slice(0, 10);
    const tue = new Date(`${date}T12:00:00Z`).getUTCDay() === 2, sat = date === "2026-01-10";
    agents.push({ id: `d${d}`, name: "x", status: "ended", born: date, ended: date, merit: 1, series: [{ date, value: tue ? 90 : sat ? 10 : 0, weight: 1 }] });
  }
  const r = rhythm(doc(agents));
  assert.equal(r.stats.top, "Tue");
  assert.equal(r.chart.rows.reduce((s, x) => s + x.median, 0), 100);
  assert.match(r.finding, /Most merit lands on Tuesdays \(97%\); the weekend carries 3%/);
});

test("records: holder, history of who broke it and when, and the holder on a given day", () => {
  const a = (id, born, ended, merit, stats = {}, extra = {}) => ({ id, name: id.split(" ")[0], status: "ended", born, ended, merit, stats, ...extra });
  const d = { options: { minMerit: 0.1 }, metrics: [{ key: "merged", label: "PRs merged" }], agents: [
    a("Ada #1", "2026-01-01", "2026-01-03", 5, { merged: 2, hours: 4 }, { score: 70 }),
    a("Bo #1", "2026-01-02", "2026-01-08", 9, { merged: 1, hours: 9 }, { score: 60 }),
    a("Ada #2", "2026-01-09", "2026-01-10", 7, { merged: 5, hours: 3 }, { score: 70 }),     // ties a score: keeps the earlier holder
    { id: "Cy #1", name: "Cy", status: "alive", born: "2026-01-01", merit: 99, stats: { merged: 50 } },  // alive: no records yet
  ] };
  const r = Object.fromEntries(records(d).map((x) => [x.key, x]));
  assert.deepEqual(r.life.history.map((e) => [e.id, e.value, e.date]), [["Ada #1", 3, "2026-01-03"], ["Bo #1", 7, "2026-01-08"]]);
  assert.equal(r.metric.title, "Most PRs merged");
  assert.equal(r.metric.holder.id, "Ada #2");
  assert.equal(r.score.holder.id, "Ada #1");
  assert.equal(r.lineage.holder.name, "Ada");
  assert.equal(r.lineage.holder.value, 2);
  assert.equal(holderOn(r.life, "2026-01-05").id, "Ada #1");
  assert.equal(holderOn(r.life, "2025-12-31"), null);
});
