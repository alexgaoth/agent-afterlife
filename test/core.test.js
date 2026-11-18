import { test } from "node:test";
import assert from "node:assert/strict";
import { formula, track, toDoc, anonymise, metricsFor, dayOf } from "../cli/core.js";
import { validate } from "../shared/afterlife.js";

process.env.TZ = "UTC";

test("merit formulas: arithmetic, functions, missing stats, and no code", () => {
  const f = (src, s = {}) => formula(src)(s);
  assert.equal(f("prs*5 + commits + hours/4", { prs: 2, commits: 3, hours: 2 }), 13.5);
  assert.equal(f("(a + b) * 2 - -1", { a: 1, b: 2 }), 7);
  assert.equal(f("max(a, b, 3) + min(a, 1) + sqrt(16) + log1p(0)", { a: 5, b: 2 }), 10);
  assert.equal(f("missing * 10 + 1"), 1);
  assert.equal(f("a / b", { a: 1, b: 0 }), 0);
  assert.equal(f(".5 + 1e1"), 10.5);
  for (const bad of ["a +", "a b", "process.exit(1)", "eval(1)", "a;b", "("]) assert.throws(() => formula(bad), /merit formula/, bad);
});

test("track: hours are gaps up to the idle limit, on the day they happen", () => {
  const s = track({ name: "Ada", idleMinutes: 15 });
  s.at("2026-01-05T09:00:00Z").at("2026-01-05T09:10:00Z");     // 10 min
  s.count("commits", 1, "2026-01-05T09:20:00Z");                // +10 min
  s.at("2026-01-05T13:00:00Z");                                 // gap too long: no hours
  s.count("commits", 2, "2026-01-06T09:00:00Z");
  s.count("cost_usd", 1.5).set("model", "m1");
  const out = s.session({ url: "u" });
  assert.equal(out.name, "Ada");
  assert.deepEqual(out.days, { "2026-01-05": { hours: 0.33, commits: 1 }, "2026-01-06": { commits: 2, cost_usd: 1.5 } });
  assert.deepEqual(out.stats, { hours: 0.33, commits: 3, cost_usd: 1.5, model: "m1" });
  assert.equal(out.url, "u");
  assert.equal(track({ name: "x" }).session(), null);
});

test("toDoc: generations, alive or ended, merit per day, percentile series", () => {
  const now = Date.parse("2026-01-10T12:00:00Z");
  const sessions = [
    { name: "Ada", start: "2026-01-05T09:00Z", end: "2026-01-06T10:00Z", days: { "2026-01-05": { commits: 1 }, "2026-01-06": { commits: 3 } } },
    { name: "Ada", start: "2026-01-07T09:00Z", end: "2026-01-07T10:00Z", stats: { commits: 2 } },
    { name: "Bo", start: "2026-01-10T11:50Z", end: "2026-01-10T11:55Z", stats: { commits: 0 } },
    { name: "", start: "2026-01-08T09:00Z", end: "2026-01-08T09:30Z", stats: { commits: 5 }, alive: false, epitaph: "Bye." },
    { name: "Bad", start: "not a date" },
  ];
  const doc = toDoc(sessions, { merit: "commits", now, title: "T", adapter: "test", tool: "t 1" });
  assert.deepEqual(validate(doc), []);
  assert.deepEqual(doc.agents.map((a) => [a.id, a.status, a.merit]), [
    ["Ada #1", "ended", 4], ["Ada #2", "ended", 2], ["Unnamed #1", "ended", 5], ["Bo #1", "alive", 0],
  ]);
  assert.deepEqual(doc.source, { tool: "t 1", adapter: "test", merit: "commits" });
  const ada = doc.agents[0];
  assert.deepEqual(ada.series.map((s) => s.date), ["2026-01-05", "2026-01-06"]);
  assert.ok(ada.series[0].value < ada.series[1].value);
  assert.equal(doc.agents[2].epitaph, "Bye.");
  assert.equal(doc.agents[3].series[0].value, 0);
});

test("metricsFor: known stats first with labels, then by how common", () => {
  const m = metricsFor([{ stats: { zeta: 1, commits: 2, hours: 1 } }, { stats: { zeta: 1, alpha: 1 } }]);
  assert.deepEqual(m.map((x) => x.key), ["commits", "hours", "zeta", "alpha"]);
  assert.deepEqual(m[1], { key: "hours", label: "Hours worked", unit: " h" });
  assert.equal(m[2].label, "Zeta");
});

test("anonymise: stable, distinct names; no urls or epitaphs", () => {
  const s = [{ name: "Ada", url: "u", epitaph: "e" }, { name: "Bo" }, { name: "Ada" }];
  const a = anonymise(s), b = anonymise(s);
  assert.deepEqual(a.map((x) => x.name), b.map((x) => x.name));
  assert.equal(a[0].name, a[2].name);
  assert.notEqual(a[0].name, a[1].name);
  assert.ok(!("url" in a[0]) && !("epitaph" in a[0]));
  assert.ok(!a.some((x) => /Ada|Bo/.test(x.name)));
});

test("dayOf uses the local calendar day", () => {
  assert.equal(dayOf("2026-01-05T23:30:00Z"), "2026-01-05");
  assert.equal(dayOf(1767657000), "2026-01-05");   // seconds
});
