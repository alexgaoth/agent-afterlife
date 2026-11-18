// Adapter for Cursor: the SQLite database state.vscdb in Cursor's globalStorage (and, for old chats, workspaceStorage/*/).
//   macOS  ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb
//   Linux  ~/.config/Cursor/User/globalStorage/state.vscdb      (Windows: %APPDATA%/Cursor/User/globalStorage)
// Read with the `sqlite3` command-line tool (execFile, `-readonly -json`); without it the adapter stops with an error.
//
// Cursor is closed source and has no public spec. The formats below come from two community readers that read the file:
//   S2thend/cursor-history (src/core/storage.ts, src/core/parser.ts, docs/cursor_history_message_data_structure_analysis_report.md,
//   docs/cursor_unified_data_model_compatibility_report.md; commit b40612e) and thomas-pedersen/cursor-chat-browser
//   (src/types/workspace.ts, src/app/api/composers/route.ts; commit 1cfdd0f), plus saharmor/cursor-view (commit 21426e2) for bubbles.
// Formats supported:
//   1. Current: table cursorDiskKV (key TEXT, value BLOB), JSON values.
//        "composerData:<id>"            one chat/agent session { _v (10 in the 2025-12 report), composerId, name?, createdAt (ms),
//                                       lastUpdatedAt (ms), modelConfig?: { modelName }, fullConversationHeadersOnly: [{ bubbleId, type }] }
//        "bubbleId:<composerId>:<id>"   one message { _v (3), bubbleId, type: 1 (user) | 2 (assistant), createdAt (ISO text, from about
//                                       2025-09), timingInfo?: { clientRpcSendTime, clientSettleTime, clientEndTime } (ms, older bubbles),
//                                       tokenCount?: { inputTokens, outputTokens } (usually 0) or usage?: { input_tokens, output_tokens },
//                                       toolFormerData?: { name, params | rawArgs } }
//        fullConversationHeadersOnly is the real conversation: Cursor leaves the bubbles of rewound or edited messages in the table
//        without a reference, so when the list is there only the bubbles it names are counted.
//   2. Older global rows: "composerData:<id>" with the messages inline, { conversation: [{ type, bubbleId, text, timestamp?, ... }] },
//        and no bubbleId rows. Read when a session has no bubble rows.
//   3. Old workspace databases, table ItemTable: key "composer.composerData" = { allComposers: [{ composerId, name, createdAt,
//        lastUpdatedAt, conversation? }], composerDataVersion }, and the first chat panel: key "workbench.panel.aichat.view.aichat.chatdata"
//        (or "workbench.panel.chat.view.chat.chatdata") = { tabs | chatSessions: [{ tabId | id, chatTitle | title, lastSendTime | createdAt,
//        bubbles | messages: [{ type | role: "user" | "ai", timestamp? }] }] }. A session already read from a global database is not read twice.
// Only the fields above are pulled out (with json_extract and json_each), so message text never leaves the database; rows that are not
// valid JSON are skipped.
// Session name: the session's `name` (its title) with --opt names=title, else "Cursor".
// Counted: prompts = type-1 (or "user") bubbles; tool_calls = bubbles with toolFormerData; edits = edit/write/patch tools; commands = terminal tools.
// Unknown format: a session whose composerData `_v` is not a whole number from 1 to MAX_COMPOSER_V is skipped and reported once with
// that version; a database with neither cursorDiskKV nor ItemTable chat rows is reported too. If nothing at all can be read the adapter
// throws. MAX_COMPOSER_V is a guess from one report (10): raise it when a newer version is checked.
//
// Uncertain: key names and fields change between Cursor versions, and the shapes above were not verified against a real database (none
// on this machine). A session with no bubbles still appears, with its created and last-updated times.
import { execFile } from "node:child_process";
import { platform } from "node:os";
import { stat } from "node:fs/promises";
import { unknownFormats } from "./unknown.js";

const DB = "Cursor/User/globalStorage/state.vscdb";
const defaultPath = platform() === "darwin" ? `~/Library/Application Support/${DB}`
  : platform() === "win32" ? `~/AppData/Roaming/${DB}` : `~/.config/${DB}`;
const EDIT_TOOL = /(edit|write|replace|patch|create_file|delete_file)/i;
const TERMINAL_TOOL = /(terminal|shell|run_command|bash)/i;

function sqlite(db, query) {
  return new Promise((resolve, reject) => {
    execFile("sqlite3", ["-readonly", "-json", db, query], { maxBuffer: 1 << 29, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === "ENOENT") return reject(new Error("the sqlite3 command-line tool is not installed or not on PATH; install it (for example `brew install sqlite` or `apt install sqlite3`) and run again"));
        return reject(new Error(`sqlite3 failed: ${String(stderr || err.message).trim().split("\n")[0]}`));
      }
      try { resolve(stdout.trim() ? JSON.parse(stdout) : []); } catch { reject(new Error("sqlite3 returned output that is not JSON")); }
    });
  });
}

const json = (text) => { try { return JSON.parse(text); } catch { return null; } };

const MAX_COMPOSER_V = 20;
const LEGACY_CHAT_KEYS = ["workbench.panel.aichat.view.aichat.chatdata", "workbench.panel.chat.view.chat.chatdata"];

// A JSON value from a column; rows that are not valid JSON read as {} instead of stopping the whole query.
const valid = (col) => `CASE WHEN json_valid(CAST(${col} AS TEXT)) THEN CAST(${col} AS TEXT) ELSE '{}' END`;
const x = (src, path) => `json_extract(${src}, '${path}')`;
// The bubble fields read from one JSON value `src` (a bubble row, or one item of an inline conversation).
const bubbleColumns = (src) => [
  `${x(src, "$.type")} AS type`, `${x(src, "$.createdAt")} AS created`, `${x(src, "$.timestamp")} AS stamp`,
  `COALESCE(${x(src, "$.timingInfo.clientRpcSendTime")}, ${x(src, "$.timingInfo.clientSettleTime")}, ${x(src, "$.timingInfo.clientEndTime")}) AS timing`,
  `COALESCE(${x(src, "$.tokenCount.inputTokens")}, ${x(src, "$.usage.input_tokens")}) AS tin`,
  `COALESCE(${x(src, "$.tokenCount.outputTokens")}, ${x(src, "$.usage.output_tokens")}) AS tout`,
  `${x(src, "$.toolFormerData.name")} AS tool`,
  `CASE WHEN ${x(src, "$.toolFormerData.name")} LIKE '%terminal%' OR ${x(src, "$.toolFormerData.name")} LIKE '%shell%' OR ${x(src, "$.toolFormerData.name")} LIKE '%run_command%' OR ${x(src, "$.toolFormerData.name")} LIKE '%bash%' ` +
    `THEN COALESCE(${x(src, "$.toolFormerData.params")}, ${x(src, "$.toolFormerData.rawArgs")}) END AS params`,
].join(", ");
const composerColumns = (src) => [
  `${x(src, "$.name")} AS name`, `${x(src, "$.createdAt")} AS created`, `${x(src, "$.lastUpdatedAt")} AS updated`,
  `${x(src, "$.modelConfig.modelName")} AS model`,
].join(", ");

const isUser = (b) => b.type === 1 || b.type === "1" || b.type === "user" || b.role === "user";

export default {
  name: "cursor",
  description: "Cursor chat and agent sessions (state.vscdb; needs the sqlite3 tool). --opt names=title",
  defaultPath,
  merit: "prs_merged*5 + prs_opened*2 + commits + edits/20 + hours/4",
  async sessions(path, ctx) {
    const dbs = await ctx.files(path, /state\.vscdb$/);
    if (!dbs.length) throw new Error(`no state.vscdb under ${path}`);
    const sessions = [], seen = new Set();
    const unknownSession = unknownFormats("cursor", "session"), unknownDb = unknownFormats("cursor", "database");

    // One session from its record and its bubbles; `count` is how the bubbles are told apart from prompts.
    const build = (id, c, bubbles) => {
      try {
        const t = ctx.track({ name: (ctx.options.names === "title" && typeof c.name === "string" && c.name.trim()) || "Cursor" });
        t.at(c.created); t.at(c.updated);
        let tokens = 0;
        for (const b of bubbles) {
          const at = b.created ?? b.stamp ?? b.timing ?? undefined;
          if (isUser(b)) t.count("prompts", 1, at);
          else t.at(at);
          tokens += (Number(b.tin) || 0) + (Number(b.tout) || 0);
          if (typeof b.tool === "string" && b.tool) {
            t.count("tool_calls", 1, at);
            if (TERMINAL_TOOL.test(b.tool)) {
              t.count("commands", 1, at);
              const p = typeof b.params === "string" ? json(b.params) : b.params;
              const ev = ctx.shellEvents(p?.command);
              for (const k of ["commits", "prs_opened", "prs_merged", "tests"]) if (ev[k]) t.count(k, ev[k], at);
            } else if (EDIT_TOOL.test(b.tool)) t.count("edits", 1, at);
          }
        }
        if (tokens) t.count("tokens", tokens);
        if (typeof c.model === "string" && c.model) t.set("model", c.model);
        const s = t.session();
        if (s) sessions.push(s);
      } catch (e) { ctx.log(`skipping a session: ${e.message}`); }
    };
    const byId = (rows) => { const m = new Map(); for (const r of rows) { const k = String(r.id); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };

    const tablesOf = new Map();
    for (const db of dbs) {
      if (!(await stat(db).catch(() => null))) throw new Error(`cannot read ${db}`);
      const names = new Set((await sqlite(db, "SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name));
      tablesOf.set(db, names);
      if (!names.has("cursorDiskKV") && !names.has("ItemTable")) { unknownDb.add(); continue; }
      unknownDb.recognized();
    }

    // 1 and 2: global rows (cursorDiskKV), the current layout first.
    for (const db of dbs) {
      if (!tablesOf.get(db).has("cursorDiskKV")) continue;
      const kv = valid("value");
      const composers = await sqlite(db, `SELECT substr(key, 14) AS id, ${x(kv, "$._v")} AS v, ${composerColumns(kv)} FROM cursorDiskKV WHERE key LIKE 'composerData:%'`);
      const headers = byId(await sqlite(db, `SELECT substr(c.key, 14) AS id, json_extract(h.value, '$.bubbleId') AS bid FROM cursorDiskKV c, json_each(${valid("c.value")}, '$.fullConversationHeadersOnly') h WHERE c.key LIKE 'composerData:%'`));
      const rows = await sqlite(db, `SELECT key, ${bubbleColumns(kv)} FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'`);
      const bubbles = new Map();
      for (const r of rows) {
        const [, id, bid] = String(r.key).split(":");
        if (!bubbles.has(id)) bubbles.set(id, []);
        bubbles.get(id).push({ ...r, bid });
      }
      const inline = byId(await sqlite(db, `SELECT substr(c.key, 14) AS id, ${bubbleColumns("b.value")} FROM cursorDiskKV c, json_each(${valid("c.value")}, '$.conversation') b WHERE c.key LIKE 'composerData:%'`));
      for (const c of composers) {
        const v = c.v === null || c.v === undefined ? undefined : Number(c.v);
        if (v !== undefined && !(Number.isInteger(v) && v >= 1 && v <= MAX_COMPOSER_V)) { unknownSession.add(c.v); continue; }
        unknownSession.recognized();
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        const named = headers.get(c.id)?.map((h) => h.bid) ?? [];
        const own = bubbles.get(c.id);
        const list = own ? (named.length ? own.filter((b) => named.includes(b.bid)) : own) : inline.get(c.id) ?? [];
        build(c.id, c, list);
      }
    }

    // 3: old workspace databases (ItemTable).
    for (const db of dbs) {
      if (!tablesOf.get(db).has("ItemTable")) continue;
      const item = valid("i.value");
      const composers = await sqlite(db, `SELECT json_extract(c.value, '$.composerId') AS id, ${composerColumns("c.value")} FROM ItemTable i, json_each(${item}, '$.allComposers') c WHERE i.key = 'composer.composerData'`);
      const inline = byId(await sqlite(db, `SELECT json_extract(c.value, '$.composerId') AS id, ${bubbleColumns("b.value")} FROM ItemTable i, json_each(${item}, '$.allComposers') c, json_each(c.value, '$.conversation') b WHERE i.key = 'composer.composerData'`));
      for (const c of composers) {
        if (typeof c.id !== "string" || seen.has(c.id)) continue;
        unknownSession.recognized();
        seen.add(c.id);
        build(c.id, c, inline.get(c.id) ?? []);
      }
      for (const key of LEGACY_CHAT_KEYS) for (const list of ["tabs", "chatSessions"]) {
        const tabs = await sqlite(db, `SELECT t.key AS idx, COALESCE(${x("t.value", "$.tabId")}, ${x("t.value", "$.id")}) AS id, COALESCE(${x("t.value", "$.chatTitle")}, ${x("t.value", "$.title")}) AS name, ` +
          `${x("t.value", "$.createdAt")} AS created, ${x("t.value", "$.lastSendTime")} AS updated FROM ItemTable i, json_each(${item}, '$.${list}') t WHERE i.key = '${key}'`);
        const msgs = new Map();
        for (const field of ["bubbles", "messages"]) {
          for (const r of await sqlite(db, `SELECT t.key AS id, ${x("b.value", "$.type")} AS type, ${x("b.value", "$.role")} AS role, COALESCE(${x("b.value", "$.timestamp")}, ${x("b.value", "$.createdAt")}) AS stamp ` +
            `FROM ItemTable i, json_each(${item}, '$.${list}') t, json_each(t.value, '$.${field}') b WHERE i.key = '${key}'`)) {
            if (!msgs.has(String(r.id))) msgs.set(String(r.id), []);
            msgs.get(String(r.id)).push(r);
          }
        }
        for (const tab of tabs) {
          const id = `${key}:${tab.id ?? tab.idx}`;
          if (seen.has(id)) continue;
          unknownSession.recognized();
          seen.add(id);
          build(id, tab, msgs.get(String(tab.idx)) ?? []);
        }
      }
    }
    unknownDb.finish(ctx);
    unknownSession.finish(ctx);
    return sessions;
  },
};
