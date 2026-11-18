// Adapter for the OpenAI Codex CLI: ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl
//
// Format assumed. One JSON object per line: { timestamp, type, payload }.
//   type "session_meta"    payload { id, cwd, ... }                       (first line)
//   type "turn_context"    payload { model, cwd, ... }
//   type "response_item"   payload.type: "message" (role user|assistant), "function_call" { name, arguments: JSON text },
//                          "custom_tool_call" { name, input }, "local_shell_call" { action: { command } }, "web_search_call"
//   type "event_msg"       payload.type: "user_message", "exec_command_end", "patch_apply_end", "token_count" { info.total_token_usage },
//                          and in newer versions "item_completed" { item: { type: "UserMessage" | "CommandExecution" { command } | "FileChange" } }
// Newer versions compress finished sessions to "*.jsonl.zst"; those are read with Node's zlib (Node 22.15+) or the `zstd` tool.
// A title comes from ~/.codex/session_index.jsonl ({ id, thread_name }); else the folder name of the session's cwd.
//
// Verified on the structure of real local logs (newer format: session_meta, turn_context, response_item, item_completed,
// token_count, session_index). The older format (shell function_call with a "command" array, apply_patch, user_message
// events) is assumed from the public Codex source and not seen here. Each kind is counted from one source only
// (the newer item_completed events when a log has them, else the older calls), so nothing counts twice.
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { basename, dirname, join } from "node:path";

const run = promisify(execFile);
const SHELL_TOOLS = /^(shell|shell_command|local_shell|container\.exec|exec_command|bash)$/;

async function* records(file, ctx) {
  if (!file.endsWith(".zst")) { yield* ctx.lines(file); return; }
  let text;
  const raw = await readFile(file);
  if (typeof zlib.zstdDecompressSync === "function") text = zlib.zstdDecompressSync(raw).toString("utf8");
  else {
    try { text = (await run("zstd", ["-dc", file], { maxBuffer: 1 << 30, encoding: "utf8" })).stdout; }
    catch { throw new Error("needs Node 22.15+ or the zstd tool to read .zst sessions"); }
  }
  for (const line of text.split("\n")) {
    if (!line) continue;
    try { yield JSON.parse(line); } catch { /* torn line */ }
  }
}

/** The shell command text of a tool call's arguments: a string, or an argv list like ["bash","-lc","..."]. */
export function commandText(a) {
  if (!a || typeof a !== "object") return "";
  const c = a.command ?? a.cmd;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.length >= 3 && /(^|\/)(ba|z|da)?sh$/.test(String(c[0])) && /^-\w*c$/.test(String(c[1])) ? String(c[2]) : c.join(" ");
  return "";
}

async function titles(dir, ctx) {
  const out = new Map();
  for (const index of [join(dir, "session_index.jsonl"), join(dirname(dir), "session_index.jsonl")]) {
    try { for await (const r of ctx.lines(index)) if (r && typeof r.id === "string" && typeof r.thread_name === "string" && r.thread_name) out.set(r.id, r.thread_name); } catch { /* no index */ }
  }
  return out;
}

export default {
  name: "codex",
  description: "OpenAI Codex CLI sessions (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl, also .jsonl.zst)",
  defaultPath: "~/.codex/sessions",
  merit: "prs_merged*5 + prs_opened*2 + commits + edits/20 + hours/4",
  async sessions(dir, ctx) {
    const sessions = [];
    const names = await titles(dir, ctx);
    for (const file of await ctx.files(dir, /rollout-[^/]*\.jsonl(\.zst)?$/)) {
      try {
        let id, cwd, model;
        const prompts = { event: [], item: [], message: [] };
        const cmds = { item: [], call: [] }, edits = { item: [], call: [] };
        const toolCalls = [], all = [];
        let tokens = 0;
        for await (const r of records(file, ctx)) {
          if (!r || typeof r !== "object") continue;
          const p = r.payload && typeof r.payload === "object" ? r.payload : {}, at = r.timestamp;
          all.push(at);
          if (r.type === "session_meta") { id ??= p.id; cwd ??= p.cwd; }
          else if (r.type === "turn_context") { model = typeof p.model === "string" ? p.model : model; cwd ??= p.cwd; }
          else if (r.type === "response_item") {
            if (p.type === "message" && p.role === "user") {
              const first = Array.isArray(p.content) ? p.content[0]?.text : "";
              if (!r.metadata?.inherited_user_message && !(typeof first === "string" && first.trimStart().startsWith("<"))) prompts.message.push(at);   // "<...>" is injected context
            }
            else if (p.type === "function_call" || p.type === "custom_tool_call" || p.type === "local_shell_call" || p.type === "web_search_call") {
              toolCalls.push(at);
              let args = null;
              if (p.type === "function_call") { try { args = JSON.parse(p.arguments); } catch { args = null; } }
              if (p.type === "local_shell_call") cmds.call.push([at, commandText(p.action)]);
              else if (p.type === "function_call" && SHELL_TOOLS.test(p.name || "")) cmds.call.push([at, commandText(args)]);
              if (p.name === "apply_patch" || (p.type === "local_shell_call" || p.type === "function_call") && /^\s*apply_patch\b/.test(commandText(p.type === "local_shell_call" ? p.action : args))) edits.call.push(at);
            }
          } else if (r.type === "event_msg") {
            if (p.type === "user_message") prompts.event.push(at);
            else if (p.type === "patch_apply_end" || p.type === "patch_apply_begin") { /* counted via the calls */ }
            else if (p.type === "token_count") { const n = p.info?.total_token_usage?.total_tokens; if (typeof n === "number") tokens = Math.max(tokens, n); }
            else if (p.type === "item_completed" && p.item && typeof p.item === "object") {
              const t = p.item.type, when = p.completed_at_ms ?? at;
              if (t === "UserMessage") prompts.item.push(when);
              else if (t === "CommandExecution") cmds.item.push([when, typeof p.item.command === "string" ? p.item.command : commandText(p.item)]);
              else if (t === "FileChange") edits.item.push(when);
            }
          }
        }
        const t = ctx.track({ name: names.get(id) || (cwd ? basename(String(cwd)) : "") || "Codex" });
        for (const a of all) t.at(a);
        const prompt = [prompts.event, prompts.item, prompts.message].find((x) => x.length) || [];
        for (const a of prompt) t.count("prompts", 1, a);
        for (const a of toolCalls) t.count("tool_calls", 1, a);
        const cmd = cmds.item.length ? cmds.item : cmds.call;
        for (const [a, text] of cmd) {
          t.count("commands", 1, a);
          const ev = ctx.shellEvents(text);
          for (const k of ["commits", "prs_opened", "prs_merged", "tests"]) if (ev[k]) t.count(k, ev[k], a);
        }
        for (const a of edits.item.length ? edits.item : edits.call) t.count("edits", 1, a);
        if (model) t.set("model", model);
        if (tokens) t.count("tokens", tokens);
        const s = t.session();
        if (s) sessions.push(s);
      } catch (e) { ctx.log(`skipping ${basename(file)}: ${e.message}`); }
    }
    return sessions;
  },
};
