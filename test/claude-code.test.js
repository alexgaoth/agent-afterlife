import { test } from "node:test";
import assert from "node:assert/strict";
import adapter from "../cli/adapters/claude-code.js";
import { runAdapter } from "../cli/adapters/index.js";
import { toDoc } from "../cli/core.js";
import { validate } from "../shared/afterlife.js";

process.env.TZ = "UTC";
const ROOT = new URL("./fixtures/claude-code/projects", import.meta.url).pathname;

test("claude-code: names, counted work, failed merges, subagents", async () => {
  const [a, b] = await runAdapter(adapter, ROOT);
  assert.equal(a.name, "Ada");                         // the session's own name
  assert.equal(b.name, "demo-app");                    // unnamed: the project folder's name
  assert.deepEqual(
    { prompts: a.stats.prompts, edits: a.stats.edits, commits: a.stats.commits, tests: a.stats.tests, prs_opened: a.stats.prs_opened,
      prs_merged: a.stats.prs_merged, commands: a.stats.commands, tool_calls: a.stats.tool_calls, subagents: a.stats.subagents,
      cost_usd: a.stats.cost_usd, lines_added: a.stats.lines_added, model: a.stats.model },
    { prompts: 1, edits: 1, commits: 1, tests: 1, prs_opened: 1, prs_merged: 1, commands: 3, tool_calls: 4, subagents: 1,
      cost_usd: 1.25, lines_added: 40, model: "claude-x" });
  assert.equal(a.stats.hours, 0.25);                  // 09:00 to 09:15, no gap over 15 minutes
  assert.deepEqual([b.stats.edits, b.stats.prompts, b.stats.commits], [1, 1, undefined]);
  assert.ok(!("alive" in a));                          // no sessions folder next to the fixture: alive by recency
});

test("claude-code: --opt names=project and names=session", async () => {
  const p = await runAdapter(adapter, ROOT, { options: { names: "project" } });
  assert.deepEqual(p.map((s) => s.name), ["demo-app", "demo-app"]);
  const s = await runAdapter(adapter, ROOT, { options: { names: "session" } });
  assert.deepEqual(s.map((x) => x.name), ["Ada", "Unnamed"]);
});

test("claude-code: the document is valid and uses the adapter's merit", async () => {
  const doc = toDoc(await runAdapter(adapter, ROOT), { merit: adapter.merit, metrics: adapter.metrics, now: "2026-02-01T00:00:00Z" });
  assert.deepEqual(validate(doc), []);
  assert.equal(doc.agents[0].merit, 8.11);   // 5 + 2 + 1 + 1/20 + 0.25/4, to 2 places
});
