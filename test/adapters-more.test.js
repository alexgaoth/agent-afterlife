// The adapters for Cline, Continue, GitHub Copilot's coding agent, the OpenAI Agents SDK, LangSmith and Langfuse. All fixtures are made up
// (test/fixtures/<tool>/); see the header comment of each adapter for the source its format comes from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.TZ = "UTC";
import { loadAdapter, runAdapter, helpers, BUILT_IN } from "../cli/adapters/index.js";
import copilot, { isCopilot } from "../cli/adapters/copilot-agent.js";
import { toDoc } from "../cli/core.js";
import { validate } from "../shared/afterlife.js";

const fixture = (p) => new URL(`fixtures/${p}`, import.meta.url).pathname;
const pick = (s, keys) => Object.fromEntries(keys.map((k) => [k, s.stats[k] ?? 0]));
const COUNTS = ["prompts", "tool_calls", "edits", "commands", "commits", "prs_opened", "tests"];

async function run(name, path, options = {}) {
  const logs = [];
  const adapter = await loadAdapter(name);
  const sessions = await runAdapter(adapter, path, { options, log: (m) => logs.push(m) });
  return { adapter, sessions, logs };
}
/** The sessions become a document that passes the schema. */
function check({ adapter, sessions }) {
  const doc = toDoc(sessions, { merit: adapter.merit, now: "2026-01-06T00:00:00Z", adapter: adapter.name });
  assert.deepEqual(validate(doc), []);
  assert.ok(doc.agents.length > 0);
  for (const a of doc.agents) assert.ok(a.merit >= 0);
  return doc;
}
const text = (tool, n, version = "") => `${tool}: ${n} ${n === 1 ? "file" : "files"} in an unknown format${version}, skipped; please open an issue with the line types, not the content`;
const byName = (sessions, name) => sessions.find((s) => s.name === name);

test("the new adapters are registered, after the harness adapters", () => {
  const names = BUILT_IN.map((a) => a.name);
  for (const n of ["cline", "continue", "copilot-agent", "openai-agents", "langsmith", "langfuse"]) assert.ok(names.includes(n), n);
  assert.ok(names.indexOf("cline") > names.indexOf("openhands") && names.indexOf("langfuse") < names.indexOf("git"));
  for (const a of BUILT_IN) assert.equal(typeof a.sessions, "function");
});

// ------------------------------------------------------------------------------------------------ cline
test("cline: one life per task, named by its workspace, counts without text", async () => {
  const r = await run("cline", fixture("cline"));
  assert.deepEqual(r.sessions.map((s) => s.name).sort(), ["gadgets", "widgets"]);
  const w = byName(r.sessions, "widgets");
  // task, user_feedback = 2 prompts; new file + 2 commands + read = 4 tool calls; the partial command is skipped
  assert.deepEqual(pick(w, COUNTS), { prompts: 2, tool_calls: 4, edits: 1, commands: 2, commits: 1, prs_opened: 0, tests: 1 });
  assert.deepEqual([w.stats.tokens, w.stats.cost_usd, w.stats.model, w.stats.hours], [150, 0.01, "model-a", 0.5]);
  const g = byName(r.sessions, "gadgets");   // workspace read from the API history's environment details
  assert.deepEqual(pick(g, COUNTS), { prompts: 1, tool_calls: 1, edits: 1, commands: 0, commits: 0, prs_opened: 0, tests: 0 });
  assert.equal(g.stats.hours, 0.03);
  check(r);
});

test("cline: a ui_messages.json in a format it does not know is reported, and an import of only those fails", async () => {
  await assert.rejects(run("cline", fixture("cline-unknown")), { message: text("cline", 1, " (version 7)") });
  const dir = mkdtempSync(join(tmpdir(), "aa-more-"));
  try {
    cpSync(fixture("cline"), dir, { recursive: true });
    cpSync(fixture("cline-unknown/tasks/9"), join(dir, "tasks", "9"), { recursive: true });
    const r = await run("cline", dir);
    assert.equal(r.sessions.length, 2);
    assert.deepEqual(r.logs, [text("cline", 1, " (version 7)").slice("cline: ".length)]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------------------------------------ continue
test("continue: a session file, its creation time and last save, tools and usage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aa-more-"));
  try {
    cpSync(fixture("continue"), dir, { recursive: true });
    const end = new Date("2026-01-05T09:12:00Z");
    utimesSync(join(dir, "sessions", "s1.json"), end, end);   // the adapter reads the modified time as the last activity
    const r = await run("continue", join(dir, "sessions"));
    assert.equal(r.sessions.length, 1);
    const [s] = r.sessions;
    assert.equal(s.name, "widgets");
    assert.deepEqual(pick(s, COUNTS), { prompts: 2, tool_calls: 3, edits: 1, commands: 1, commits: 1, prs_opened: 0, tests: 0 });
    assert.deepEqual([s.stats.tokens, s.stats.cost_usd, s.stats.model, s.stats.hours], [120, 0.02, "model-a", 0.2]);
    check(r);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("continue: a file that is no session is reported (sessions.json is not one)", async () => {
  await assert.rejects(run("continue", fixture("continue-unknown/sessions")), { message: text("continue", 1) });
});

// ------------------------------------------------------------------------------------------------ copilot-agent
test("copilot-agent: only Copilot's pull requests, each a life named Copilot, paged until --since", async () => {
  const pr = (n, o = {}) => ({ number: n, url: `https://example.com/pull/${n}`, state: "MERGED", createdAt: "2026-01-05T09:00:00Z", mergedAt: "2026-01-05T12:00:00Z",
    closedAt: "2026-01-05T12:00:00Z", headRefName: "feature", body: "", author: { login: "ada" }, additions: 100, deletions: 10, changedFiles: 3,
    commits: { totalCount: 2 }, reviews: { totalCount: 1 }, comments: { totalCount: 0 }, ...o });
  const pages = [
    { nodes: [pr(5, { author: { login: "copilot-swe-agent" }, state: "OPEN", mergedAt: null, closedAt: null, updatedAt: "2026-01-07T00:00:00Z" }),
      pr(4, { headRefName: "claude/fix-login" }),                     // another agent: not Copilot's
      pr(3, { author: { login: "Copilot" } })], pageInfo: { hasNextPage: true, endCursor: "c1" } },
    { nodes: [pr(2, { headRefName: "copilot/fix-2" }), pr(1, { author: { login: "copilot-swe-agent" }, createdAt: "2025-12-01T00:00:00Z" })], pageInfo: { hasNextPage: true, endCursor: "c2" } },
  ];
  const calls = [];
  const ctx = { ...helpers({ since: Date.parse("2026-01-01") }), graphql: async (q, v) => { calls.push(v.cursor); return { repository: { pullRequests: pages[calls.length - 1] } }; } };
  const s = await copilot.sessions("acme/demo", ctx);
  assert.deepEqual(calls, [null, "c1"]);   // stopped at the PR older than --since
  assert.deepEqual(s.map((x) => [x.name, x.alive, x.stats.prs_merged ?? 0, x.stats.repo]), [["Copilot", true, 0, "demo"], ["Copilot", false, 1, "demo"], ["Copilot", false, 1, "demo"]]);
  assert.equal(s[0].url, "https://example.com/pull/5");
  assert.deepEqual(check({ adapter: copilot, sessions: s }).agents.map((a) => a.name), ["Copilot", "Copilot", "Copilot"]);
  assert.equal(isCopilot({ author: { login: "ada" }, headRefName: "feature/copilot-notes" }), false);
  assert.equal(isCopilot({ author: { login: "copilot-swe-agent[bot]" } }), true);
  await assert.rejects(copilot.sessions("not-a-repo", ctx), /owner\/repo/);
});

// ------------------------------------------------------------------------------------------------ openai-agents
test("openai-agents: one life per trace, named by the workflow (or the first agent span)", async () => {
  const r = await run("openai-agents", fixture("openai-agents"));
  assert.deepEqual(r.sessions.map((s) => s.name), ["Triage workflow", "Reviewer"]);
  const [t, rev] = r.sessions;
  assert.deepEqual(pick(t, COUNTS), { prompts: 1, tool_calls: 3, edits: 1, commands: 1, commits: 1, prs_opened: 0, tests: 0 });
  assert.deepEqual([t.stats.handoffs, t.stats.generations, t.stats.tokens, t.stats.model, t.stats.hours], [1, 1, 120, "model-a", 0.17]);
  assert.deepEqual([rev.stats.tokens, rev.stats.generations, rev.stats.hours], [15, 1, 0.08]);
  check(r);
});

test("openai-agents: a file with no trace or span records is reported", async () => {
  await assert.rejects(run("openai-agents", fixture("openai-agents-unknown")), { message: text("openai-agents", 1, " (version 3)") });
  const r = await run("openai-agents", fixture("openai-agents"));
  assert.deepEqual(r.logs, []);
});

// ------------------------------------------------------------------------------------------------ langsmith
test("langsmith: one life per trace; tokens from llm runs only; nested child_runs; zone-less times are UTC", async () => {
  const r = await run("langsmith", fixture("langsmith"));
  assert.deepEqual(r.sessions.map((s) => s.name).sort(), ["Planner", "Writer"]);
  const p = byName(r.sessions, "Planner");
  assert.deepEqual(pick(p, COUNTS), { prompts: 1, tool_calls: 2, edits: 1, commands: 1, commits: 0, prs_opened: 0, tests: 1 });
  assert.deepEqual([p.stats.tokens, p.stats.cost_usd, p.stats.model, p.stats.generations, p.stats.hours], [120, 0.002, "model-a", 1, 0.17]);
  assert.equal(new Date(p.start).toISOString(), "2026-01-05T09:00:00.000Z");
  const w = byName(r.sessions, "Writer");
  assert.deepEqual(pick(w, COUNTS), { prompts: 1, tool_calls: 1, edits: 0, commands: 1, commits: 1, prs_opened: 1, tests: 0 });
  assert.equal(w.stats.hours, 0.1);
  check(r);
  const tagged = await run("langsmith", fixture("langsmith"), { names: "tag" });
  assert.deepEqual(tagged.sessions.map((s) => s.name).sort(), ["planner", "writer"]);
});

test("langsmith: a file that is no run export is reported", async () => {
  await assert.rejects(run("langsmith", fixture("langsmith-unknown")), { message: text("langsmith", 1) });
});

// ------------------------------------------------------------------------------------------------ langfuse
test("langfuse: a trace with observations, loose observations, and a listed trace; names by trace, agent, then tag", async () => {
  const r = await run("langfuse", fixture("langfuse"));
  assert.deepEqual(r.sessions.map((s) => s.name).sort(), ["Researcher", "listed", "support-agent"]);
  const t = byName(r.sessions, "support-agent");
  assert.deepEqual(pick(t, COUNTS), { prompts: 1, tool_calls: 2, edits: 1, commands: 1, commits: 0, prs_opened: 1, tests: 0 });
  assert.deepEqual([t.stats.tokens, t.stats.cost_usd, t.stats.model, t.stats.generations, t.stats.hours], [120, 0.01, "model-a", 1, 0.17]);
  const o = byName(r.sessions, "Researcher");   // no trace record: named by its AGENT observation
  assert.deepEqual([o.stats.tokens, o.stats.model, o.stats.hours], [15, "model-b", 0.07]);
  assert.equal(byName(r.sessions, "listed").stats.hours, 0.03);   // only timestamp + latency
  check(r);
  const tagged = await run("langfuse", fixture("langfuse"), { names: "tag" });
  assert.ok(tagged.sessions.some((s) => s.name === "billing"));
});

test("langfuse: a file that is no trace or observation export is reported", async () => {
  await assert.rejects(run("langfuse", fixture("langfuse-unknown")), { message: text("langfuse", 1, " (version 9)") });
});
