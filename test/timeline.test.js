import { test } from "node:test";
import assert from "node:assert/strict";
import { days, asOf } from "../shared/timeline.js";
import { demo, validate, ranked } from "../shared/afterlife.js";

const a = (id, born, ended, merit, series) => ({ id, name: id, status: ended ? "ended" : "alive", born, ...(ended ? { ended } : {}), merit, series });

test("asOf: born later is absent, ended later is alive with merit so far, ended earlier is as it was", () => {
  const data = { schema: "agent-afterlife/1", options: { minMerit: 0.1 }, agents: [
    a("A", "2026-01-01", "2026-01-03", 6, [{ date: "2026-01-01", value: 50, weight: 2 }, { date: "2026-01-03", value: 50, weight: 4 }]),
    a("B", "2026-01-04", null, 3, [{ date: "2026-01-04", value: 60, weight: 1 }]),
    a("C", "2026-01-02", "2026-01-02", 1, []),
  ], edicts: [{ date: "2026-01-02T08:00:00Z", items: [{ kind: "founded", count: 1 }] }, { date: "2026-01-05T08:00:00Z", items: [{ kind: "founded", count: 2 }] }] };
  assert.deepEqual(days(data), ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]);
  const d2 = asOf(data, "2026-01-02");
  assert.deepEqual(d2.agents.map((x) => [x.id, x.status, x.merit]), [["A", "alive", 2], ["C", "ended", 1]]);   // A: 100 of 300 so far
  assert.equal(d2.agents[0].ended, undefined);
  assert.equal(d2.edicts.length, 1);
  const d4 = asOf(data, "2026-01-04");
  assert.deepEqual(d4.agents.map((x) => [x.id, x.status, x.merit]), [["A", "ended", 6], ["B", "alive", 3], ["C", "ended", 1]]);
});

test("asOf the last day is the fleet itself; every day of the demo is a valid document", () => {
  const d = demo();
  const all = days(d);
  const last = asOf(d, all.at(-1));
  assert.deepEqual(ranked({ ...last, options: d.options }).map((x) => x.id), ranked(d).map((x) => x.id));
  for (const day of all) assert.deepEqual(validate(asOf(d, day)), [], day);
});
