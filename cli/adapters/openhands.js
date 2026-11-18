// Adapter for OpenHands' local file store: ~/.openhands (override: OH_PERSISTENCE_DIR / FILE_STORE_PATH in OpenHands)
//
// Formats supported, read from the public OpenHands source (the repo is now OpenHands/OpenHands, earlier All-Hands-AI/OpenHands;
// the agent SDK is OpenHands/software-agent-sdk). One JSON file per event; the folder that holds them is one session.
//   1. Agent SDK / CLI, "conversations/<id>/events/event-00000-<uuid>.json" with "conversations/<id>/base_state.json"
//        (software-agent-sdk, openhands-sdk/openhands/sdk/conversation/persistence_const.py and event/base.py, main and 1.0.0a1).
//        Event: { id, timestamp (ISO, local), source: "user"|"agent"|"environment", kind: "MessageEvent" | "ActionEvent" | ...,
//        tool_name, action: { kind: "TerminalAction" | "ExecuteBashAction" { command } | "FileEditorAction" | "PlanningFileEditorAction"
//        { command: "view"|"create"|"str_replace"|"insert"|"undo_edit", path } | "ApplyPatchAction" | "EditAction" | "WriteFileAction" } }.
//        base_state.json: agent.llm.model, stats.usage_to_metrics.<id>.{accumulated_cost, accumulated_token_usage}, workspace.working_dir.
//   2. App server (GUI, OpenHands/OpenHands 1.0.0 and later, openhands/app_server/event/event_service_base.py): events are the same
//        SDK events, "v1_conversations/<conversation hex>/<event hex>.json" (under "<user id>/" when there is a user), and in
//        1.0.0 "v1/events/<conversation uuid>/<YYYYMMDDHHMMSS>_<Kind>_<hex>" with no extension. The title and model are in the
//        app's database, not in files, so the name is "OpenHands" and no model, cost or tokens are read.
//   3. Older event stream, "sessions/<sid>/events/<n>.json" (and "users/<user id>/conversations/<sid>/events/<n>.json" from 0.45.0),
//        with "metadata.json" beside events/ (openhands/storage/locations.py, events/serialization/event.py, conversation_metadata.py
//        at 0.9.0, 0.20.0, 0.45.0). Event: { id, timestamp, source, action: "run" { args.command } | "edit" | "write" | "read" |
//        "message" | "browse" | "think" | "finish" | "recall" | ..., args, llm_metrics } or an observation { observation, content, extras }.
//        metadata.json: title, llm_model, accumulated_cost, prompt_tokens, completion_tokens, selected_repository. When it has no cost
//        or tokens, the last llm_metrics of the events is used.
//   Not read: "event_cache/<a>-<b>.json" pages (copies of events), agent_state.pkl, init.json.
// Prompts: events from source "user" that are messages. Tool calls: every action event except messages, thinking and finish.
// Edits: file-editor actions that change files (create, str_replace, insert, undo_edit), patch and write actions, and old "edit"/"write" actions.
// Commands: bash/terminal actions and old "run" actions.
// Name: the basename of the workspace folder, else "OpenHands". With --opt names=title, the metadata title first.
// Unknown format: a conversation whose event files are all unreadable or have none of kind/action/observation is skipped and
// reported once, with a version field when one is there. Unknown event kinds inside a known conversation are skipped.
//
// Uncertain: layouts come from source code only; no real OpenHands data was available. The title and model of app-server
// conversations are not in the files.
import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { unknownFormats, versionOf } from "./unknown.js";

const FILE_WRITE = /^(create|str_replace|insert|undo_edit|write|edit)$/;
const NON_TOOL_ACTIONS = new Set(["message", "think", "finish", "system", "change_agent_state", "condensation", "null", "recall", "streaming_message"]);
const NON_TOOL_TOOLS = new Set(["think", "finish"]);
const ALWAYS_EDITS = /^(ApplyPatchAction|EditAction|WriteFileAction)$/;
// events/<name>.json, v1_conversations/<id>/<name>.json, v1/events/<id>/<14 digits>_<Kind>_<hex> (no extension)
const EVENT_FILE = /\/(?:events\/[^/]+\.json|v1_conversations\/[^/]+\/[^/]+\.json|v1\/events\/[^/]+\/\d{14}_[A-Za-z]+_[0-9a-f]+)$/;

async function readJson(file) { try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; } }
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export default {
  name: "openhands",
  description: "OpenHands conversations (~/.openhands: <id>/events/*.json)",
  defaultPath: "~/.openhands",
  merit: "prs_merged*5 + prs_opened*2 + commits + edits/20 + hours/4",
  async sessions(dir, ctx) {
    const groups = new Map();
    for (const file of await ctx.files(dir, EVENT_FILE, { maxDepth: 8 })) {
      const home = /\/events\/[^/]+$/.test(file) && !/\/v1\/events\//.test(file) ? dirname(dirname(file)) : dirname(file);
      if (!groups.has(home)) groups.set(home, []);
      groups.get(home).push(file);
    }
    const sessions = [];
    const unknown = unknownFormats("openhands", "conversation");
    for (const [home, events] of groups) {
      try {
        const state = (await readJson(`${home}/base_state.json`)) || {};
        const meta = (await readJson(`${home}/metadata.json`)) || {};
        const workspace = state.workspace?.working_dir ?? state.workspace?.path ?? meta.selected_repository;
        const title = typeof meta.title === "string" && meta.title.trim() ? meta.title.trim() : typeof state.title === "string" ? state.title.trim() : "";
        const t = ctx.track({ name: (ctx.options.names === "title" && title) || (workspace ? basename(String(workspace).replace(/\/+$/, "")) : "") || "OpenHands" });
        events.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        let seen = 0, version = versionOf(state) ?? versionOf(meta), lastMetrics;
        for (const file of events) {
          const e = await readJson(file);
          if (!e || typeof e !== "object" || Array.isArray(e)) continue;
          if (typeof e.kind !== "string" && !("action" in e) && !("observation" in e)) { version ??= versionOf(e); continue; }
          seen++;
          if (e.llm_metrics && typeof e.llm_metrics === "object") lastMetrics = e.llm_metrics;
          const at = e.timestamp;
          t.at(at);
          const kind = typeof e.kind === "string" ? e.kind : "";
          const action = e.action;                                        // an object (new) or a string (old)
          const verb = typeof action === "string" ? action : action?.kind ?? "";
          const isAction = kind === "ActionEvent" || (typeof action === "string" && e.source === "agent");
          if ((kind === "MessageEvent" || action === "message") && e.source === "user") { t.count("prompts", 1, at); continue; }
          if (!isAction) continue;
          if (NON_TOOL_ACTIONS.has(verb) || NON_TOOL_TOOLS.has(e.tool_name)) continue;
          t.count("tool_calls", 1, at);
          const sub = typeof action === "object" ? action?.command : undefined;      // file-editor sub-command
          const isBash = /^(run|ExecuteBashAction|TerminalAction)$/.test(verb) || /^(terminal|execute_bash|bash)$/.test(e.tool_name || "");
          if (isBash) {
            t.count("commands", 1, at);
            const ev = ctx.shellEvents(typeof action === "string" ? e.args?.command : action?.command);
            for (const k of ["commits", "prs_opened", "prs_merged", "tests"]) if (ev[k]) t.count(k, ev[k], at);
          } else if (verb === "edit" || verb === "write" || ALWAYS_EDITS.test(verb) || (/FileEditor/.test(verb) && FILE_WRITE.test(String(sub)))) t.count("edits", 1, at);
        }
        if (!seen) { unknown.add(version); continue; }
        unknown.recognized();
        const model = meta.llm_model ?? state.agent?.llm?.model;
        if (typeof model === "string" && model) t.set("model", model);
        let tokens = num(meta.prompt_tokens) + num(meta.completion_tokens), cost = num(meta.accumulated_cost);
        if (!tokens && !cost && !state.stats && lastMetrics) {        // old event streams without metadata.json numbers
          cost = num(lastMetrics.accumulated_cost);
          tokens = num(lastMetrics.accumulated_token_usage?.prompt_tokens) + num(lastMetrics.accumulated_token_usage?.completion_tokens);
        }
        for (const m of Object.values(state.stats?.usage_to_metrics ?? {})) {
          cost += num(m?.accumulated_cost);
          tokens += num(m?.accumulated_token_usage?.prompt_tokens) + num(m?.accumulated_token_usage?.completion_tokens);
        }
        if (tokens) t.count("tokens", tokens);
        if (cost) t.count("cost_usd", Math.round(cost * 1e4) / 1e4);
        const s = t.session();
        if (s) sessions.push(s);
      } catch (e) { ctx.log(`skipping ${basename(home)}: ${e.message}`); }
    }
    unknown.finish(ctx);
    return sessions;
  },
};
