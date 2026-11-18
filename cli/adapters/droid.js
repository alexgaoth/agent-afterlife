// Adapter for Factory Droid: ~/.factory/sessions/<project folder>/<session id>.jsonl (+ <session id>.settings.json)
//
// Format assumed, from the structure of real local logs. One JSON object per line:
//   { type: "session_start", id, title, cwd, ... }                       (first line; title may be auto-made)
//   { type: "message", id, timestamp, message: { role: "user" | "assistant", content: [...], visibility?, modelId? } }
//        content blocks are Anthropic-style: { type: "text" | "thinking" | "tool_use" { name, input } | "tool_result" }
//   other line types (todo_state, compaction_state, agent_turn_outcome, ...) are skipped.
// A prompt is a user message with a text block that is not hook output (hookEventName) and not "llm_only" (injected context).
// Tools by name: Execute { command } = shell; Edit, Create, ApplyPatch, MultiEdit = file writes; every tool_use is a tool call.
// <session id>.settings.json holds { model, tokenUsage: { inputTokens, outputTokens, ... } }; read when present.
// The session name is the recorded title, else the basename of cwd (the project folder), else the sessions folder's name.
//
// Verified on the structure of real local logs. Uncertain: the "llm_only" visibility rule for prompts is inferred
// from the values seen (llm_only, user_only, none); other Droid versions may name tools differently.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const EDIT_TOOLS = /^(Edit|Create|ApplyPatch|MultiEdit|Write|NotebookEdit)$/;

export default {
  name: "droid",
  description: "Factory Droid sessions (~/.factory/sessions/**/*.jsonl)",
  defaultPath: "~/.factory/sessions",
  merit: "prs_merged*5 + prs_opened*2 + commits + edits/20 + hours/4",
  async sessions(dir, ctx) {
    const sessions = [];
    for (const file of await ctx.files(dir, /\.jsonl$/)) {
      try {
        let title, cwd, model;
        const t = ctx.track({ name: "" });
        for await (const r of ctx.lines(file)) {
          if (!r || typeof r !== "object") continue;
          if (r.type === "session_start") { title ||= typeof r.title === "string" ? r.title.trim() : ""; cwd ||= r.cwd; continue; }
          if (r.type !== "message" || !r.message || typeof r.message !== "object") continue;
          const m = r.message, at = r.timestamp, blocks = Array.isArray(m.content) ? m.content : [];
          t.at(at);
          if (typeof m.modelId === "string") model = m.modelId;
          if (m.role === "user") {
            if (!m.hookEventName && m.visibility !== "llm_only" && blocks.some((b) => b?.type === "text" && typeof b.text === "string")) t.count("prompts", 1, at);
          } else if (m.role === "assistant") {
            for (const b of blocks) {
              if (b?.type !== "tool_use") continue;
              t.count("tool_calls", 1, at);
              if (EDIT_TOOLS.test(b.name || "")) t.count("edits", 1, at);
              if (b.name === "Execute") {
                t.count("commands", 1, at);
                const ev = ctx.shellEvents(b.input?.command);
                for (const k of ["commits", "prs_opened", "prs_merged", "tests"]) if (ev[k]) t.count(k, ev[k], at);
              }
            }
          }
        }
        let settings = {};
        try { settings = JSON.parse(await readFile(file.replace(/\.jsonl$/, ".settings.json"), "utf8")); } catch { /* no settings file */ }
        if (typeof settings.model === "string") model = settings.model;
        const u = settings.tokenUsage;
        if (u && typeof u === "object") {
          const n = (Number(u.inputTokens) || 0) + (Number(u.outputTokens) || 0);
          if (n) t.count("tokens", n);
        }
        if (model) t.set("model", model);
        const s = t.session({ name: title || (cwd ? basename(String(cwd)) : "") || "Droid" });
        if (s) sessions.push(s);
      } catch (e) { ctx.log(`skipping ${basename(file)}: ${e.message}`); }
    }
    return sessions;
  },
};
