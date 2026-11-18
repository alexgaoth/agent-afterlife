import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validate } from "../shared/afterlife.js";

process.env.TZ = "UTC";
const here = (p) => new URL(p, import.meta.url).pathname;
const cli = (...a) => spawnSync(process.execPath, [here("../bin/agent-afterlife.js"), ...a], { encoding: "utf8" });

test("walkthrough step 1: runs.csv with no code", () => {
  const r = cli("import", here("../examples/cron/runs.csv"), "--merit", "prs_merged*5", "--out", "-");
  const doc = JSON.parse(r.stdout);
  assert.deepEqual(validate(doc), []);
  assert.deepEqual(doc.agents.map((a) => [a.id, a.merit]), [["triage #1", 10], ["triage #2", 0], ["release-notes #1", 5]]);
});

test("walkthrough step 2: the 28-line adapter reads the run logs", () => {
  const r = cli("import", here("../examples/cron/cron-adapter.js"), here("../examples/cron"), "--out", "-");
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.deepEqual(validate(doc), []);
  assert.equal(doc.source.merit, "prs_merged*5 + tests_passed + tool_calls/10");
  const [a, b] = doc.agents;
  assert.deepEqual([a.stats.tool_calls, a.stats.tests_passed, a.stats.prs_merged, a.stats.hours], [2, 1, 2, 0.69]);
  assert.equal(b.epitaph, "Stopped with exit code 1.");
});

test("walkthrough: run-agent.sh records a run that the adapter then reads", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "aa-cron-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const agent = `echo '{"time":"2026-01-08T02:00:30Z","kind":"pr_merged"}' >> "$RUN_LOG"`;
  const r = spawnSync("bash", [here("../examples/cron/run-agent.sh"), "triage"], { encoding: "utf8", env: { ...process.env, AFTERLIFE_RUNS_DIR: dir, AGENT_CMD: agent } });
  assert.equal(r.status, 0, r.stderr);
  const rows = readFileSync(join(dir, "runs.csv"), "utf8").trim().split("\n");
  assert.equal(rows.length, 2);
  assert.match(rows[1], /^r-\d{4}-\d{4},triage,.*,0,1$/);
  const doc = JSON.parse(cli("import", here("../examples/cron/cron-adapter.js"), dir, "--out", "-").stdout);
  assert.equal(doc.agents[0].stats.prs_merged, 1);
});

test("the walkthrough shows the adapter exactly as it is in examples/cron", () => {
  const doc = readFileSync(here("../docs/walkthrough-cron.md"), "utf8");
  const shown = /```js\n([\s\S]*?)```/.exec(doc)[1].trim();
  const file = readFileSync(here("../examples/cron/cron-adapter.js"), "utf8").split("\n").filter((l) => !l.startsWith("// The adapter for") && !l.startsWith("//   agent-afterlife")).join("\n").trim();
  assert.equal(shown, file);
});
