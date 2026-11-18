// Adapter for OpenHands' local file store: ~/.openhands/<conversations|sessions>/<id>/events/*.json
//
// Format assumed, from the public OpenHands source (software-agent-sdk event files, and the older event stream):
//   One JSON file per event, in an "events" folder; the folder above it is one session.
//   New:  events/event-00000-<uuid>.json  { id, timestamp (ISO), source: "user"|"agent"|"environment", kind: "MessageEvent" | "ActionEvent" | ...,
//         tool_name, action: { kind: "ExecuteBashAction" { command } | "FileEditorAction" { command: "create"|"str_replace"|"insert"|"view", path } } }
//   Old:  events/<n>.json  { id, timestamp, source, action: "run" { args.command } | "edit" | "write" | "read" | "message" | "browse" | ..., args }
//   Beside events/: base_state.json (new: agent.llm.model, stats..., workspace.working_dir) or metadata.json (old: title, llm_model,
//   accumulated_cost, prompt_tokens, completion_tokens, selected_repository); both are read when present.
// Prompts: events from source "user" that are messages. Tool calls: every action event except messages, thinking and finish.
// Edits: file-editor actions that change files (create, str_replace, insert, undo_edit) and old "edit"/"write" actions.
// Commands: bash/terminal actions and old "run" actions.
// Name: the basename of the workspace folder, else "OpenHands". With --opt names=title, the metadata title first.
//
// Uncertain: both layouts come from source code only; no real OpenHands data was available. Field names differ between
// versions, so each is probed in a few places and unknown events are skipped. Cost and tokens are read when a metadata file has them.
import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

const FILE_WRITE = /^(create|str_replace|insert|undo_edit|write|edit)$/;
const NON_TOOL_ACTIONS = new Set(["message", "think", "finish", "system", "change_agent_state", "condensation", "null"]);
const NON_TOOL_TOOLS = new Set(["think", "finish"]);

async function readJson(file) { try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; } }
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export default {
  name: "openhands",
  description: "OpenHands conversations (~/.openhands: <id>/events/*.json)",
  defaultPath: "~/.openhands",
  merit: "prs_merged*5 + prs_opened*2 + commits + edits/20 + hours/4",
  async sessions(dir, ctx) {
    const groups = new Map();
    for (const file of await ctx.files(dir, /\/events\/[^/]+\.json$/, { maxDepth: 8 })) {
      const home = dirname(dirname(file));
      if (!groups.has(home)) groups.set(home, []);
      groups.get(home).push(file);
    }
    const sessions = [];
    for (const [home, events] of groups) {
      try {
        const state = (await readJson(`${home}/base_state.json`)) || {};
        const meta = (await readJson(`${home}/metadata.json`)) || {};
        const workspace = state.workspace?.working_dir ?? state.workspace?.path ?? meta.selected_repository;
        const title = typeof meta.title === "string" && meta.title.trim() ? meta.title.trim() : typeof state.title === "string" ? state.title.trim() : "";
        const t = ctx.track({ name: (ctx.options.names === "title" && title) || (workspace ? basename(String(workspace).replace(/\/+$/, "")) : "") || "OpenHands" });
        events.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        for (const file of events) {
          const e = await readJson(file);
          if (!e || typeof e !== "object") continue;
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
          } else if (verb === "edit" || verb === "write" || (/FileEditor/.test(verb) && FILE_WRITE.test(String(sub)))) t.count("edits", 1, at);
        }
        const model = meta.llm_model ?? state.agent?.llm?.model;
        if (typeof model === "string" && model) t.set("model", model);
        let tokens = num(meta.prompt_tokens) + num(meta.completion_tokens), cost = num(meta.accumulated_cost);
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
    return sessions;
  },
};
