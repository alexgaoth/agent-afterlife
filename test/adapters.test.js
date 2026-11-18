import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCsv, rowsToSessions } from "../cli/adapters/generic.js";
import { loadAdapter, runAdapter } from "../cli/adapters/index.js";
import { validate } from "../shared/afterlife.js";

process.env.TZ = "UTC";
const here = (p) => new URL(p, import.meta.url).pathname;
const BIN = here("../bin/agent-afterlife.js");
const cli = (...a) => spawnSync(process.execPath, [BIN, ...a], { encoding: "utf8", env: { ...process.env, TZ: "UTC" } });

test("parseCsv: quotes, escaped quotes, newlines in quotes, CRLF, types, TSV", () => {
  const rows = parseCsv('name,n,ok,note\r\n"Bo, Jr",3,true,"say ""hi""\nthere"\r\nAda,1.5,false,\r\n\r\n');
  assert.deepEqual(rows, [{ name: "Bo, Jr", n: 3, ok: true, note: 'say "hi"\nthere' }, { name: "Ada", n: 1.5, ok: false, note: "" }]);
  assert.deepEqual(parseCsv("a\tb\n1\tx\n"), [{ a: 1, b: "x" }]);
});

test("records: sessions, events and day rows", () => {
  const [ev] = rowsToSessions([
    { Agent: "Ada", Time: "2026-01-05T09:00:00Z", Kind: "Commit" },
    { agent: "Ada", time: "2026-01-05T09:06:00Z", kind: "PR merged", n: 2 },
  ]);
  assert.deepEqual(ev.stats, { hours: 0.1, commit: 1, pr_merged: 2 });
  const [se] = rowsToSessions([{ name: "Bo", start: "2026-01-05T09:00Z", end: "2026-01-05T10:30Z", commits: 2, status: "running" }]);
  assert.deepEqual([se.stats.hours, se.stats.commits, se.alive], [1.5, 2, true]);
  const [dy] = rowsToSessions([{ name: "Cy", date: "2026-01-05", merged: 2, hours: 3, score: 70 }, { name: "Cy", day: "2026-01-06", merged: 1 }]);
  assert.deepEqual(Object.keys(dy.days), ["2026-01-05", "2026-01-06"]);
  assert.deepEqual([dy.stats.merged, dy.stats.hours, dy.score], [3, 3, 70]);
  const split = rowsToSessions([{ name: "Ada", session: 1, time: "2026-01-05T09:00Z" }, { name: "Ada", session: 2, time: "2026-01-06T09:00Z" }]);
  assert.equal(split.length, 2);
  // Two session rows with one name and no session id are two lives (generations), not one.
  const rows = rowsToSessions([{ name: "Ada", start: "2026-01-05T09:00Z", end: "2026-01-05T10:00Z" }, { name: "Ada", start: "2026-01-06T09:00Z", end: "2026-01-06T09:30Z" }]);
  assert.deepEqual(rows.map((x) => x.stats.hours), [1, 0.5]);
});

test("the example adapter and example files import to valid documents", async () => {
  const a = await loadAdapter(here("../examples/my-adapter.js"));
  const sessions = await runAdapter(a, here("../examples/runs"));
  assert.deepEqual(sessions.map((s) => [s.name, s.stats.commits ?? 0]), [["Ada", 2], ["Ada", 1], ["Basil", 0]]);
  for (const f of ["../examples/events.csv", "../examples/sessions.csv"]) {
    const r = cli("import", here(f), "--out", "-");
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(validate(JSON.parse(r.stdout)), []);
  }
});

test("import: --merit, --since, --anonymize, --title, and errors", () => {
  const r = cli("import", here("../examples/events.csv"), "--out", "-", "--merit", "commit*2", "--title", "Mine", "--anonymize", "--since", "2026-01-06");
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.title, "Mine");
  assert.equal(doc.source.merit, "commit*2");
  assert.equal(doc.agents.length, 2);                       // Ada's last event was on the 5th
  assert.ok(!doc.agents.some((x) => /Ada|Basil|Cleo/.test(x.name)));
  assert.match(cli("import", "no-such-adapter").stderr, /no adapter/);
  assert.match(cli("import", here("../examples/events.csv"), "--merit", "commit +").stderr, /merit formula/);
  assert.match(cli("import", here("fixtures/minimal.json")).stderr, /already an Agent Afterlife document/);
});

test("serve and build take a source as well as a document", () => {
  const dir = mkdtempSync(join(tmpdir(), "aa-"));
  try {
    const r = cli("build", here("../examples/sessions.csv"), "--out", join(dir, "site"));
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(dir, "site", "data.json")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a custom adapter written as ES module in a plain .js file loads on every Node version", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "aa-esm-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "mine.js");                      // no package.json with "type": "module" here
  writeFileSync(file, 'export default { name: "mine", async sessions(path, { track }) { return [track({ name: "Ada" }).at("2026-01-05T09:00:00Z").session()]; } };\n');
  const a = await loadAdapter(file);
  assert.equal(a.name, "mine");
  assert.equal((await runAdapter(a, dir)).length, 1);
  assert.deepEqual(readdirSync(dir), ["mine.js"]);       // the temporary .mjs copy is gone
});
