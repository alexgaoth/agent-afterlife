// Adapter for Continue (continuedev/continue): chat sessions as JSON under ~/.continue/sessions/ (the IDE extensions and the cn CLI
// write the same files; CONTINUE_GLOBAL_DIR moves the folder).
//
// Format, read from continuedev/continue @ 5522c6f44ca0 (2026-11-17):
//   core/util/history.ts, core/util/paths.ts     sessions/<sessionId>.json  and the list sessions/sessions.json
//   core/index.d.ts                              Session, BaseSessionMetadata, ChatHistoryItem, ChatMessage, ToolCallState, Usage
//   sessions/<id>.json   { sessionId, title, workspaceDirectory, history: [{ message: { role, content, toolCalls?, usage? }, toolCallStates? }],
//                          mode?, chatModelTitle?, usage?: { promptTokens, completionTokens, totalCost } }
//   sessions/sessions.json  [{ sessionId, title, dateCreated (ms, as text), workspaceDirectory, messageCount }]
// The messages carry NO timestamps. A session starts at its dateCreated (sessions.json) and ends at the file's modified time (the file is
// rewritten on every change), so hours are real only for sessions worked in one sitting (gaps over 15 minutes count as 0, as everywhere),
// and the counts are placed on the last day. Without sessions.json, the file's times alone give a session of 0 hours.
// Counted: prompts = user messages; tool_calls = assistant tool calls; edits = edit_existing_file, single_find_and_replace, multi_edit,
// create_new_file; commands = run_terminal_command (the "command" argument goes through shellEvents for commits, PRs and tests);
// tokens = usage.promptTokens + completionTokens, cost_usd = usage.totalCost, model = chatModelTitle (a title the user gave a model).
// Name: the basename of workspaceDirectory; "Continue" when empty. Never the session title (it is made from the first prompt).
// Unknown format: a sessions/*.json that is not an object with a history list is skipped and reported once (sessions.json is not one).
//
// How sure: the shape follows the current source and the old format (session_id, no sessionId) is skipped as the source itself does;
// I did not see real session files. The missing times make hours low: medium.
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { unknownFormats, versionOf } from "./unknown.js";
import { isObject } from "./trace-util.js";

const EDITS = new Set(["edit_existing_file", "single_find_and_replace", "multi_edit", "create_new_file"]);

export default {
  name: "continue",
  description: "Continue sessions (~/.continue/sessions/<id>.json). Times are only the creation and last save",
  defaultPath: "~/.continue/sessions",
  merit: "prs_merged*5 + prs_opened*2 + commits + edits/20 + hours/4",
  async sessions(dir, ctx) {
    const sessions = [];
    const unknown = unknownFormats("continue");
    const created = new Map();
    for (const list of await ctx.files(dir, /[\\/]sessions\.json$/)) {
      try {
        const rows = JSON.parse(await readFile(list, "utf8"));
        if (Array.isArray(rows)) for (const r of rows) if (isObject(r) && typeof r.sessionId === "string") created.set(r.sessionId, Number(r.dateCreated));
      } catch { /* a broken list is not fatal: the session files are read on their own */ }
    }
    for (const file of await ctx.files(dir, /\.json$/)) {
      if (basename(file) === "sessions.json") continue;
      try {
        let s;
        try { s = JSON.parse(await readFile(file, "utf8")); } catch { unknown.add(); continue; }
        if (!isObject(s) || !Array.isArray(s.history)) { unknown.add(versionOf(s)); continue; }
        unknown.recognized();
        const end = (await stat(file)).mtimeMs;
        const id = typeof s.sessionId === "string" ? s.sessionId : basename(file, ".json");
        const born = created.get(id);
        const start = Number.isFinite(born) && born > 0 && born <= end ? born : end;
        const t = ctx.track({ name: (typeof s.workspaceDirectory === "string" && basename(s.workspaceDirectory.replace(/[\\/]+$/, ""))) || "Continue" });
        t.at(start).at(end);
        let prompts = 0, calls = 0, edits = 0, commands = 0, shell = { commits: 0, prs_opened: 0, prs_merged: 0, tests: 0 };
        for (const h of s.history) {
          const m = h?.message;
          if (!isObject(m)) continue;
          if (m.role === "user") prompts++;
          const states = Array.isArray(h.toolCallStates) ? h.toolCallStates : [];
          const calls_ = states.length ? states.map((c) => c?.toolCall?.function ?? {}) : (Array.isArray(m.toolCalls) ? m.toolCalls.map((c) => c?.function ?? {}) : []);
          for (const f of calls_) {
            calls++;
            if (EDITS.has(f.name)) edits++;
            else if (f.name === "run_terminal_command") {
              commands++;
              let args = {};
              try { args = typeof f.arguments === "string" ? JSON.parse(f.arguments) : f.arguments || {}; } catch { /* partial arguments */ }
              const ev = ctx.shellEvents(typeof args.command === "string" ? args.command : "");
              for (const k of Object.keys(shell)) shell[k] += ev[k];
            }
          }
        }
        const stats = { prompts, tool_calls: calls, edits, commands, ...shell };
        for (const [k, n] of Object.entries(stats)) if (n) t.count(k, n);
        const u = s.usage;
        if (isObject(u)) {
          const tokens = (Number(u.promptTokens) || 0) + (Number(u.completionTokens) || 0);
          if (tokens) t.count("tokens", tokens);
          if (Number(u.totalCost)) t.count("cost_usd", Math.round(Number(u.totalCost) * 1e4) / 1e4);
        }
        if (typeof s.chatModelTitle === "string" && s.chatModelTitle) t.set("model", s.chatModelTitle);
        const out = t.session();
        if (out) sessions.push(out);
      } catch (e) { ctx.log(`skipping ${basename(file)}: ${e.message}`); }
    }
    unknown.finish(ctx);
    return sessions;
  },
};
