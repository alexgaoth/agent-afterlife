// Each file format the aider, gemini, openhands and cursor adapters read (see the header comment of each adapter for the
// source it comes from), and what they say about formats they do not know. All fixtures are made up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.TZ = "UTC";
import { loadAdapter, runAdapter } from "../cli/adapters/index.js";

const fixture = (p) => new URL(`fixtures/${p}`, import.meta.url).pathname;
const BIN = new URL("../bin/agent-afterlife.js", import.meta.url).pathname;
const HAS_SQLITE = spawnSync("sqlite3", ["--version"]).status === 0;
const pick = (s, keys) => Object.fromEntries(keys.map((k) => [k, s.stats[k] ?? 0]));
const day = (s) => new Date(s.start).toISOString().slice(0, 10);

async function run(name, path, options = { names: "title" }) {
  const logs = [];
  const sessions = await runAdapter(await loadAdapter(name), path, { options, log: (m) => logs.push(m) });
  return { sessions, logs };
}
function scratch(files) {
  const dir = mkdtempSync(join(tmpdir(), "aa-formats-"));
  for (const [rel, text] of Object.entries(files)) {
    const f = join(dir, rel);
    mkdirSync(join(f, ".."), { recursive: true });
    writeFileSync(f, text);
  }
  return dir;
}
const text = (tool, n, version = "") => `${tool}: ${n} ${n === 1 ? "file" : "files"} in an unknown format${version}, skipped; please open an issue with the line types, not the content`;

// ------------------------------------------------------------------------------------------------ aider
test("aider: v0.86 history with cache counts, a cost line without '> ', headings in replies, <blank>", async () => {
  const { sessions } = await run("aider", fixture("aider-formats/modern"));
  const [s] = sessions;
  assert.equal(s.name, "modern");
  // "#### Plan" and "#### Step 1" are headings in the assistant's reply (no trailing spaces), "#### <blank>" is an empty Enter
  assert.deepEqual(pick(s, ["prompts", "edits", "commits", "commands", "tests", "tokens", "cost_usd"]), { prompts: 1, edits: 1, commits: 1, commands: 1, tests: 1, tokens: 4140, cost_usd: 0.032 });
  assert.equal(s.stats.model, "model-a");
});

test("aider: v0.20 history without usage lines", async () => {
  const { sessions } = await run("aider", fixture("aider-formats/v020"));
  const [s] = sessions;
  assert.equal(day(s), "2025-03-02");
  assert.deepEqual(pick(s, ["prompts", "edits", "commits", "tokens"]), { prompts: 1, edits: 1, commits: 1, tokens: 0 });
  assert.equal(s.stats.model, "gpt-4");
});

test("aider: a file with no start line is reported once; if every file is like that, it is an error", async () => {
  const good = readFileSync(fixture("aider-formats/v020/.aider.chat.history.md"), "utf8");
  const dir = scratch({ "a/.aider.chat.history.md": good, "b/.aider.chat.history.md": "just some text\n", "c/.aider.chat.history.md": "[1,2,3]", "d/.aider.chat.history.md": "" });
  const bad = scratch({ "x/.aider.chat.history.md": "nothing here\n", "y/.aider.chat.history.md": "or here\n" });
  try {
    const { sessions, logs } = await run("aider", dir);
    assert.equal(sessions.length, 1);
    assert.deepEqual(logs.filter((l) => /unknown format/.test(l)), [text("aider", 2)]);
    await assert.rejects(run("aider", bad), new Error(text("aider", 2)));
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(bad, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------------------------------------ gemini
test("gemini: current .jsonl: re-appended messages count once, $patch removeIds, tool-response and slash messages are no prompts", async () => {
  const { sessions } = await run("gemini", fixture("gemini-formats/proj1"));
  const [a] = sessions;
  assert.equal(a.name, "Add a flag");
  assert.deepEqual(pick(a, ["prompts", "tool_calls", "edits", "commands", "tests", "tokens"]), { prompts: 1, tool_calls: 2, edits: 1, commands: 1, tests: 1, tokens: 15 });
  assert.equal(a.stats.model, "model-g");
});

test("gemini: $rewindTo an unknown id drops everything; $set.messages replaces the messages", async () => {
  const { sessions } = await run("gemini", fixture("gemini-formats/proj1"));
  assert.equal(sessions[1].stats.prompts, 2);                       // "third" and "fourth"; "first" and "second" are gone
});

test("gemini: checkpoint as { history, authType } and as a bare array", async () => {
  const { sessions } = await run("gemini", fixture("gemini-formats/proj2"));
  assert.deepEqual(pick(sessions[0], ["prompts", "tool_calls", "edits"]), { prompts: 1, tool_calls: 1, edits: 1 });
  const old = await run("gemini", fixture("gemini/abc"));
  assert.ok(old.sessions.length >= 3);                              // the older shapes still read
});

test("gemini: files in an unknown format are reported once with their version; all unknown is an error", async () => {
  const goodLine = JSON.stringify({ sessionId: "s", projectHash: "h", startTime: "2026-01-01T00:00:00Z" });
  const dir = scratch({
    "p/chats/session-2026-01-01T00-00-aaaa.jsonl": `${goodLine}\n${JSON.stringify({ id: "m", timestamp: "2026-01-01T00:01:00Z", type: "user", content: "hi" })}\n`,
    "p/chats/session-2026-01-02T00-00-bbbb.jsonl": `${JSON.stringify({ version: 7, entries: [] })}\n`,
    "p/chats/session-2026-01-03T00-00-cccc.json": JSON.stringify({ version: 7, turns: [] }),
    "p/chats/session-2026-01-04T00-00-dddd.json": JSON.stringify([1, 2]),
    "p/chats/session-2026-01-05T00-00-eeee.jsonl": "",
    "p/checkpoint-x.json": JSON.stringify({ version: 7, state: {} }),
  });
  const bad = scratch({ "q/chats/session-2026-01-02T00-00-bbbb.jsonl": `${JSON.stringify({ version: 7, entries: [] })}\n`, "q/chats/session-2026-01-03T00-00-cccc.json": JSON.stringify({ version: 8 }) });
  try {
    const { sessions, logs } = await run("gemini", dir);
    assert.equal(sessions.length, 1);
    assert.deepEqual(logs.filter((l) => /unknown format/.test(l)), [text("gemini", 4, " (version 7)")]);
    await assert.rejects(run("gemini", bad), new Error(text("gemini", 2, " (version 7, 8)")));
    const cli = spawnSync("node", [BIN, "import", "gemini", bad, "--out", join(bad, "out.json")], { encoding: "utf8" });
    assert.equal(cli.status, 1);
    assert.equal(cli.stderr.trim(), text("gemini", 2, " (version 7, 8)"));    // the name is not repeated
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(bad, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------------------------------------ openhands
test("openhands: app server layouts (v1_conversations, v1/events without extension) read SDK events", async () => {
  const { sessions } = await run("openhands", fixture("openhands-formats"));
  const byName = sessions.filter((s) => s.name === "OpenHands");
  assert.equal(byName.length, 2);
  const [conv, v1] = byName.sort((a, b) => a.start - b.start).reverse();   // v1/events (Feb 4) and v1_conversations (Feb 3)
  assert.equal(day(conv), "2026-02-04");
  assert.deepEqual(pick(conv, ["prompts", "tool_calls", "edits"]), { prompts: 1, tool_calls: 1, edits: 1 });
  // terminal commit, apply_patch edit, file_editor view (a tool call, not an edit); a state-update event and an agent message are no tool calls
  assert.deepEqual(pick(v1, ["prompts", "tool_calls", "commands", "commits", "edits"]), { prompts: 1, tool_calls: 3, commands: 1, commits: 1, edits: 1 });
});

test("openhands: old users/<id>/conversations layout, observations skipped, recall is no tool call, cost from llm_metrics", async () => {
  const { sessions } = await run("openhands", fixture("openhands-formats"));
  const old = sessions.find((s) => s.name === "Add widgets");
  assert.ok(old);
  assert.deepEqual(pick(old, ["prompts", "tool_calls", "commands", "tests", "edits", "tokens", "cost_usd"]), { prompts: 1, tool_calls: 2, commands: 1, tests: 1, edits: 1, tokens: 350, cost_usd: 0.2 });
  assert.equal(old.stats.model, "model-p");
  assert.equal((await run("openhands", fixture("openhands-formats"), {})).sessions.find((s) => s.stats.model === "model-p").name, "widgets");   // folder of selected_repository
});

test("openhands: a conversation with no readable events is reported once; all unknown is an error", async () => {
  const dir = scratch({
    "conversations/ok/events/event-00000-aaaaaaaa.json": JSON.stringify({ kind: "MessageEvent", id: "aaaaaaaa", timestamp: "2026-01-01T00:00:00", source: "user" }),
    "conversations/new/events/event-00000-bbbbbbbb.json": JSON.stringify({ version: 3, payload: {} }),
    "sessions/torn/events/0.json": "{ not json",
  });
  const bad = scratch({ "conversations/new/events/event-00000-bbbbbbbb.json": JSON.stringify({ schema_version: 3, payload: {} }) });
  const unit = (n, v = "") => `openhands: ${n} ${n === 1 ? "conversation" : "conversations"} in an unknown format${v}, skipped; please open an issue with the line types, not the content`;
  try {
    const { sessions, logs } = await run("openhands", dir);
    assert.equal(sessions.length, 1);
    assert.deepEqual(logs.filter((l) => /unknown format/.test(l)), [unit(2, " (version 3)")]);
    await assert.rejects(run("openhands", bad), new Error(unit(1, " (version 3)")));
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(bad, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------------------------------------ cursor
function database(...sqlFiles) {
  const dir = mkdtempSync(join(tmpdir(), "aa-cursor-formats-"));
  const seen = new Set();   // two fixtures with the same table: create it once
  const sql = sqlFiles.map((f) => readFileSync(fixture(`cursor-formats/${f}`), "utf8")).join("\n")
    .split("\n").filter((l) => !/^CREATE TABLE/.test(l) || (!seen.has(l) && seen.add(l))).join("\n");
  assert.equal(spawnSync("sqlite3", [join(dir, "state.vscdb")], { input: sql }).status, 0);
  return dir;
}
const skip = !HAS_SQLITE && "sqlite3 is not installed";

test("cursor: current layout: _v 10 composer, headers decide which bubbles count, timingInfo and usage fallbacks, bad rows skipped", { skip }, async () => {
  const dir = database("current.sql");
  try {
    const { sessions, logs } = await run("cursor", dir);
    assert.equal(sessions.length, 1);
    const [s] = sessions;
    assert.equal(s.name, "Add login");
    // b4 is an orphan (not in fullConversationHeadersOnly): 2 prompts, not 3
    assert.deepEqual(pick(s, ["prompts", "tool_calls", "edits", "commands", "commits", "tokens"]), { prompts: 2, tool_calls: 2, edits: 1, commands: 1, commits: 1, tokens: 120 });
    assert.equal(s.stats.model, "model-c");
    assert.equal(logs.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("cursor: older global rows with the messages inline in composerData", { skip }, async () => {
  const dir = database("inline.sql");
  try {
    const { sessions } = await run("cursor", dir);
    const [s] = sessions;
    assert.equal(s.name, "Old chat");
    assert.deepEqual(pick(s, ["prompts", "tool_calls", "edits"]), { prompts: 2, tool_calls: 1, edits: 1 });
    assert.equal(s.stats.hours, 0.17);   // 08:00 to the 08:10 update
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("cursor: old workspace database: composer.composerData and the first chat panel", { skip }, async () => {
  const dir = database("workspace.sql");
  try {
    const { sessions } = await run("cursor", dir);
    assert.deepEqual(sessions.map((s) => [s.name, s.stats.prompts]).sort(), [["Panel chat", 2], ["Workspace chat", 1]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("cursor: a composerData with an unknown _v is reported once; all unknown is an error", { skip }, async () => {
  const mixed = database("current.sql", "unknown-version.sql"), bad = database("unknown-version.sql");
  const other = mkdtempSync(join(tmpdir(), "aa-cursor-formats-"));
  const unit = (n, what, v = "") => `cursor: ${n} ${what}${n === 1 ? "" : "s"} in an unknown format${v}, skipped; please open an issue with the line types, not the content`;
  try {
    const { sessions, logs } = await run("cursor", mixed);
    assert.equal(sessions.length, 1);
    assert.deepEqual(logs, [unit(2, "session", " (version 99)")]);
    await assert.rejects(run("cursor", bad), new Error(unit(2, "session", " (version 99)")));
    // a database with other tables only (a newer layout we have never seen)
    assert.equal(spawnSync("sqlite3", [join(other, "state.vscdb")], { input: "CREATE TABLE chatStore (id TEXT, blob BLOB);" }).status, 0);
    await assert.rejects(run("cursor", other), new Error(unit(1, "database")));
  } finally { for (const d of [mixed, bad, other]) rmSync(d, { recursive: true, force: true }); }
});
