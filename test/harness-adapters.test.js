import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";

process.env.TZ = "UTC";
import { loadAdapter, runAdapter } from "../cli/adapters/index.js";
import { toDoc } from "../cli/core.js";
import { validate } from "../shared/afterlife.js";

const fixture = (p) => new URL(`fixtures/${p}`, import.meta.url).pathname;
const logs = [];

async function load(name, path) {
  const adapter = await loadAdapter(name);
  const sessions = await runAdapter(adapter, path, { log: (m) => logs.push(m) });
  const doc = toDoc(sessions, { merit: adapter.merit, adapter: name, now: "2026-01-10T00:00:00Z" });
  assert.deepEqual(validate(doc), [], `${name}: document is valid`);
  assert.equal(doc.agents.length, sessions.length);
  return sessions;
}
const pick = (s, keys) => Object.fromEntries(keys.map((k) => [k, s.stats[k] ?? 0]));
const day = (s) => new Date(s.start).toISOString().slice(0, 10);

test("all six adapters are registered after the generic ones", async () => {
  for (const n of ["codex", "gemini", "droid", "aider", "cursor", "openhands"]) {
    const a = await loadAdapter(n);
    assert.equal(a.name, n);
    assert.equal(typeof a.sessions, "function");
    assert.ok(a.defaultPath && a.description && /prs_merged/.test(a.merit));
  }
});

test("codex: newer item events, older calls, session titles, bad lines", async () => {
  const [one, two] = await load("codex", fixture("codex"));
  assert.equal(one.name, "Refactor parser");                       // from session_index.jsonl
  assert.deepEqual(pick(one, ["prompts", "tool_calls", "commands", "commits", "edits", "tokens"]), { prompts: 1, tool_calls: 2, commands: 1, commits: 1, edits: 1, tokens: 3000 });
  assert.equal(one.stats.model, "model-x");
  assert.equal(one.stats.hours, 0.17);                             // 09:00 to 09:10, then a gap over 15 minutes to 09:30
  assert.equal(two.name, "other");                                 // folder name of cwd
  assert.deepEqual(pick(two, ["prompts", "tool_calls", "commands", "commits", "prs_opened", "tests", "edits"]), { prompts: 1, tool_calls: 3, commands: 2, commits: 1, prs_opened: 1, tests: 1, edits: 1 });
});

test("codex: .jsonl.zst sessions are read when zstd is available in Node", async (t) => {
  if (typeof zlib.zstdCompressSync !== "function") return t.skip("this Node has no zstd");
  const dir = mkdtempSync(join(tmpdir(), "aa-codex-"));
  try {
    mkdirSync(join(dir, "2026/01/05"), { recursive: true });
    const lines = [{ timestamp: "2026-01-05T09:00:00Z", type: "session_meta", payload: { id: "z", cwd: "/w/zst-app" } },
      { timestamp: "2026-01-05T09:01:00Z", type: "event_msg", payload: { type: "user_message" } }];
    writeFileSync(join(dir, "2026/01/05/rollout-2026-01-05T09-00-00-z.jsonl.zst"), zlib.zstdCompressSync(lines.map((l) => JSON.stringify(l)).join("\n")));
    const [s] = await load("codex", dir);
    assert.deepEqual([s.name, s.stats.prompts], ["zst-app", 1]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("gemini: jsonl with rewind and summary, legacy json, checkpoint", async () => {
  const sessions = await load("gemini", fixture("gemini"));
  const [jsonl, legacy, checkpoint] = sessions;
  assert.equal(jsonl.name, "Fix login");                           // the recorded summary
  assert.deepEqual(pick(jsonl, ["prompts", "tool_calls", "edits", "commands", "commits", "tokens"]), { prompts: 1, tool_calls: 2, edits: 1, commands: 1, commits: 1, tokens: 15 });
  assert.equal(jsonl.stats.model, "model-g");
  assert.equal(legacy.name, "demo-app");                           // from .project_root
  assert.equal(day(legacy), "2026-01-06");
  assert.equal(legacy.stats.hours, 0.17);
  assert.deepEqual(pick(checkpoint, ["prompts", "tool_calls", "edits"]), { prompts: 1, tool_calls: 1, edits: 1 });
});

test("droid: title, prompts without hook or injected messages, tools, settings", async () => {
  const [a, b] = await load("droid", fixture("droid"));
  assert.equal(a.name, "Add search");
  assert.deepEqual(pick(a, ["prompts", "tool_calls", "commands", "prs_merged", "edits", "tests", "tokens"]), { prompts: 1, tool_calls: 3, commands: 2, prs_merged: 1, edits: 1, tests: 1, tokens: 150 });
  assert.equal(a.stats.model, "model-d");
  assert.equal(a.stats.hours, 0.07);
  assert.equal(b.name, "demo-app");                                // no title: cwd basename
});

test("aider: sessions split at each start line, prompts, edits, commits, tokens", async () => {
  const [a, b] = await load("aider", fixture("aider"));
  assert.equal(a.name, "proj");
  assert.equal(day(a), "2026-01-05");
  assert.deepEqual(pick(a, ["prompts", "edits", "commits", "commands", "tests", "tokens", "cost_usd"]), { prompts: 2, edits: 1, commits: 2, commands: 2, tests: 1, tokens: 3640, cost_usd: 0.03 });
  assert.equal(a.stats.model, "model-a");
  assert.deepEqual(pick(b, ["prompts", "edits"]), { prompts: 1, edits: 1 });
  assert.equal(new Date(b.start).toISOString(), "2026-01-05T15:00:00.000Z");
});

test("openhands: new and old event stores, bad files skipped", async () => {
  const sessions = await load("openhands", fixture("openhands"));
  const [news, old] = sessions;
  assert.equal(news.name, "demo-app");
  assert.deepEqual(pick(news, ["prompts", "tool_calls", "commands", "commits", "prs_opened", "edits", "tokens", "cost_usd"]), { prompts: 1, tool_calls: 3, commands: 1, commits: 1, prs_opened: 1, edits: 1, tokens: 1200, cost_usd: 0.5 });
  assert.equal(news.stats.model, "model-o");
  assert.equal(old.name, "Old chat");
  assert.deepEqual(pick(old, ["prompts", "tool_calls", "commands", "tests", "edits", "tokens"]), { prompts: 1, tool_calls: 3, commands: 1, tests: 1, edits: 1, tokens: 15 });
  assert.equal(old.stats.hours, 0.12);
});

const HAS_SQLITE = spawnSync("sqlite3", ["--version"]).status === 0;

test("cursor: composerData and bubbles from a state.vscdb", { skip: !HAS_SQLITE && "sqlite3 is not installed" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "aa-cursor-"));
  try {
    const db = join(dir, "state.vscdb");
    const composer = JSON.stringify({ composerId: "c1", name: "Add login", createdAt: Date.parse("2026-01-05T09:00:00Z"), lastUpdatedAt: Date.parse("2026-01-05T09:20:00Z"), modelConfig: { modelName: "model-c" } });
    const bubble = (o) => JSON.stringify(o);
    const rows = [
      ["composerData:c1", composer],
      ["composerData:c2", JSON.stringify({ composerId: "c2", createdAt: Date.parse("2026-01-06T10:00:00Z"), lastUpdatedAt: Date.parse("2026-01-06T10:05:00Z") })],
      ["bubbleId:c1:b1", bubble({ type: 1, createdAt: "2026-01-05T09:00:00.000Z", text: "x" })],
      ["bubbleId:c1:b2", bubble({ type: 2, createdAt: "2026-01-05T09:02:00.000Z", tokenCount: { inputTokens: 100, outputTokens: 20 }, toolFormerData: { name: "edit_file_v2", params: "{}" } })],
      ["bubbleId:c1:b3", bubble({ type: 2, createdAt: "2026-01-05T09:03:00.000Z", toolFormerData: { name: "run_terminal_command_v2", params: JSON.stringify({ command: "git commit -m x" }) } })],
      ["unrelated:key", "{}"],
    ];
    const sql = ["CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);",
      ...rows.map(([k, v]) => `INSERT INTO cursorDiskKV VALUES ('${k}', CAST('${v.replace(/'/g, "''")}' AS BLOB));`)].join("\n");
    assert.equal(spawnSync("sqlite3", [db], { input: sql }).status, 0);
    const [a, b] = await load("cursor", dir);
    assert.equal(a.name, "Add login");
    assert.deepEqual(pick(a, ["prompts", "tool_calls", "edits", "commands", "commits", "tokens"]), { prompts: 1, tool_calls: 2, edits: 1, commands: 1, commits: 1, tokens: 120 });
    assert.equal(a.stats.model, "model-c");
    assert.equal(a.stats.hours, 0.05);                             // 09:00 to 09:03; the 09:20 update is over 15 minutes later
    assert.deepEqual([b.name, day(b)], ["Cursor", "2026-01-06"]);  // no bubbles: the session still shows
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("cursor: a clear error when sqlite3 is missing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aa-cursor-"));
  const path = process.env.PATH;
  try {
    writeFileSync(join(dir, "state.vscdb"), "");
    process.env.PATH = join(dir, "empty");
    const adapter = await loadAdapter("cursor");
    await assert.rejects(runAdapter(adapter, dir), /sqlite3 command-line tool is not installed/);
  } finally { process.env.PATH = path; rmSync(dir, { recursive: true, force: true }); }
});
