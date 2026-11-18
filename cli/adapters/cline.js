// Adapter for the Cline VS Code extension (saoudrizwan.claude-dev): one folder per task under the extension's
// globalStorage "tasks/" folder.
//
// Format, read from cline/cline @ eff43e19b267 (2026-11-17):
//   apps/vscode/src/core/storage/disk.ts            GlobalFileNames, per-task folder  tasks/<taskId>/
//   apps/vscode/src/shared/ExtensionMessage.ts      ClineMessage, ClineAsk, ClineSay, ClineSayTool, ClineApiReqInfo
//   apps/vscode/src/shared/HistoryItem.ts           taskHistory items (cwdOnTaskInitialization, modelId)
//   apps/vscode/src/core/context/context-tracking/ContextTrackerTypes.ts   task_metadata.json (model_usage)
//   tasks/<id>/ui_messages.json              array of { ts (ms), type: "ask" | "say", ask?, say?, text?, partial? }
//        say "task" (the first prompt) and say "user_feedback" are prompts; ask/say "tool" (text: JSON { tool: "editedExistingFile" |
//        "newFileCreated" | "readFile" | ... }), ask/say "command" (text: the shell command), "use_mcp_server" and say "browser_action"
//        are tool calls; say "api_req_started" (text: JSON { tokensIn, tokensOut, cacheWrites, cacheReads, cost }) gives tokens and cost.
//   tasks/<id>/task_metadata.json            { model_usage: [{ ts, model_id, model_provider_id, mode }], files_in_context, ... }
//   tasks/<id>/api_conversation_history.json  Anthropic-style messages; only the "Current Working Directory (<path>)" line of its
//        environment details is read, for the name. No message text is read or kept.
//   <storage>/state/taskHistory.json         (older layout, assumed) [{ id, cwdOnTaskInitialization, modelId, ... }]: the workspace
// Paths: macOS ~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev, Linux ~/.config/Code/User/globalStorage/...,
// Windows %APPDATA%\Code\User\globalStorage\...; the newer standalone Cline also keeps tasks under ~/.cline/data. Give the folder
// that holds tasks/ (or any folder above it).
// Name: the basename of the task's workspace folder; "Cline" when none is recorded. One task = one life. Merit: edits and PRs as the
// harness adapters, with tool calls counted a little (a task that only reads still did work).
// Unknown format: a ui_messages.json that is not a list of { ts, type } messages is skipped and reported once.
//
// How sure: the message types and the ClineApiReqInfo fields are read from the current source; the folder layout matches it. I did not
// see a real task folder, so older versions that wrote other say/ask names are counted only where the names match. Medium.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir, platform } from "node:os";
import { unknownFormats, versionOf } from "./unknown.js";
import { isObject } from "./trace-util.js";

const EXT = "saoudrizwan.claude-dev";
function storagePath() {
  const h = homedir();
  const code = platform() === "darwin" ? join(h, "Library", "Application Support", "Code", "User", "globalStorage", EXT)
    : platform() === "win32" ? join(process.env.APPDATA || join(h, "AppData", "Roaming"), "Code", "User", "globalStorage", EXT)
    : join(h, ".config", "Code", "User", "globalStorage", EXT);
  const standalone = join(h, ".cline", "data");
  return !existsSync(code) && existsSync(standalone) ? standalone : code;
}

async function json(file) { try { return JSON.parse(await readFile(file, "utf8")); } catch { return undefined; } }
const parse = (text) => { try { const v = JSON.parse(text); return isObject(v) ? v : {}; } catch { return {}; } };
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The workspace folder from the environment details of the API history ("# Current Working Directory (/path) Files"). */
function cwdFromHistory(history) {
  if (!Array.isArray(history)) return undefined;
  for (const m of history.slice(0, 6)) {
    const parts = Array.isArray(m?.content) ? m.content : typeof m?.content === "string" ? [{ text: m.content }] : [];
    for (const p of parts) {
      const hit = typeof p?.text === "string" && /# Current Working Directory \(([^)\n]+)\)/.exec(p.text);
      if (hit) return hit[1];
    }
  }
  return undefined;
}

export default {
  name: "cline",
  description: "Cline (VS Code extension) task history: <globalStorage>/saoudrizwan.claude-dev/tasks/<id>/ui_messages.json",
  defaultPath: storagePath(),
  merit: "prs_merged*5 + prs_opened*2 + commits + edits/20 + hours/4",
  async sessions(dir, ctx) {
    const sessions = [];
    const unknown = unknownFormats("cline");
    const histories = new Map();   // storage root -> Map(taskId -> history item)
    const historyOf = async (taskDir) => {
      const root = dirname(dirname(taskDir));
      if (!histories.has(root)) {
        const map = new Map();
        for (const f of [join(root, "state", "taskHistory.json"), join(root, "data", "state", "taskHistory.json")]) {
          const list = await json(f);
          if (Array.isArray(list)) for (const h of list) if (isObject(h) && h.id !== undefined) map.set(String(h.id), h);
        }
        histories.set(root, map);
      }
      return histories.get(root).get(basename(taskDir));
    };
    for (const file of await ctx.files(dir, /[\\/]tasks[\\/][^\\/]+[\\/]ui_messages\.json$/)) {
      try {
        const messages = await json(file);
        const taskDir = dirname(file);
        if (!Array.isArray(messages) || (messages.length && !messages.some((m) => isObject(m) && typeof m.ts === "number" && (m.type === "ask" || m.type === "say")))) {
          unknown.add(versionOf(messages)); continue;
        }
        unknown.recognized();
        const item = await historyOf(taskDir);
        const meta = await json(join(taskDir, "task_metadata.json"));
        const cwd = item?.cwdOnTaskInitialization || cwdFromHistory(await json(join(taskDir, "api_conversation_history.json")));
        const t = ctx.track({ name: (cwd && basename(String(cwd).replace(/[\\/]+$/, ""))) || "Cline" });
        let tokens = 0, cost = 0, model = Array.isArray(meta?.model_usage) ? meta.model_usage.at(-1)?.model_id : undefined;
        for (const m of messages) {
          if (!isObject(m) || typeof m.ts !== "number") continue;
          t.at(m.ts);
          if (m.partial) continue;
          const kind = m.type === "say" ? m.say : m.ask;
          if (m.type === "say" && (kind === "task" || kind === "user_feedback")) t.count("prompts", 1, m.ts);
          else if (kind === "tool") {
            t.count("tool_calls", 1, m.ts);
            const tool = parse(m.text).tool;
            if (tool === "editedExistingFile" || tool === "newFileCreated") t.count("edits", 1, m.ts);
          } else if (kind === "command") {
            t.count("tool_calls", 1, m.ts).count("commands", 1, m.ts);
            const ev = ctx.shellEvents(typeof m.text === "string" ? m.text.replace(/REQ_APP$/, "") : "");
            for (const k of ["commits", "prs_opened", "prs_merged", "tests"]) if (ev[k]) t.count(k, ev[k], m.ts);
          } else if (kind === "use_mcp_server" || (m.type === "say" && kind === "browser_action")) t.count("tool_calls", 1, m.ts);
          else if (m.type === "say" && kind === "api_req_started") {
            const i = parse(m.text);
            tokens += num(i.tokensIn) + num(i.tokensOut);
            cost += num(i.cost);
            if (!model && typeof m.modelInfo?.modelId === "string") model = m.modelInfo.modelId;
          }
        }
        model ||= item?.modelId;
        if (typeof model === "string" && model) t.set("model", model);
        if (tokens) t.count("tokens", tokens);
        if (cost) t.count("cost_usd", Math.round(cost * 1e4) / 1e4);
        const s = t.session();
        if (s) sessions.push(s);
      } catch (e) { ctx.log(`skipping ${basename(dirname(file))}: ${e.message}`); }
    }
    unknown.finish(ctx);
    return sessions;
  },
};
