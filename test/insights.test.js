import { test } from "node:test";
import assert from "node:assert/strict";
import { survival, insights } from "../shared/insights.js";
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
  assert.deepEqual(insights(d).map((i) => i.key), ["concentration", "survival", "chronicle", "longevity", "lineage", "quality"]);
});
