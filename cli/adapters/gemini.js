// Adapter for the Gemini CLI: ~/.gemini/tmp/<project>/chats/session-*.jsonl  (older versions: session-*.json)
//
// Formats supported, read from google-gemini/gemini-cli (packages/core/src/services/chatRecordingTypes.ts,
// chatRecordingService.ts, packages/core/src/core/logger.ts, packages/core/src/utils/sessionUtils.ts):
//   1. .jsonl (current main, commit 4f343ca, and v0.45.0 and later): one JSON value per line, replayed like the CLI does.
//        metadata  { sessionId, projectHash, startTime, lastUpdated, summary?, kind? }  (any line with both ids; merged)
//        message   { id, timestamp, type: "user" | "gemini" | "info" | "error" | "warning", content (string, part or parts),
//                    toolCalls?: [{ id, name, args, status, timestamp }], tokens?: { input, output, cached, thoughts, tool, total },
//                    model? }.  A message with an id seen before replaces the older one (the CLI re-appends a message to
//                    update it), so it is counted once.
//        { $set: {...} }       metadata update (summary, kind, ...); a legacy $set.messages replaces all messages
//        { $rewindTo: <id> }   drops that message and every later one; an unknown id drops all messages (as the CLI does)
//        { $patch: { removeIds: [...] } } drops those messages; other patches (content, tool results, order) change no counts
//   2. .json (v0.3.0 to v0.30.0 at least): one object { sessionId, projectHash, startTime, lastUpdated, messages: [...] },
//        messages with type "user" | "gemini" and the same fields as above.
//   3. checkpoint-<tag>.json (from "/chat save", logger.ts): the older form is an array of { role, parts }; the newer form is
//        { history: [{ role, parts }], authType? }. Parts hold { text } or { functionCall } or { functionResponse }. No times:
//        the file's modified time stands in for activity, and only prompts and tool calls are counted.
//   Not read: chats/<parent session>/<id>.jsonl (sub-agent recordings, kind "subagent") and logs.json (prompt log).
// A prompt is a "user" message with text that does not start with "/" or "?" and is not a "<session_context>" or
// "<hook_context>" block (the CLI's own isIgnoredUserContent); messages that only hold tool responses do not count.
// A project's folder name under tmp/ is either a hash or a name; "<folder>/.project_root", when present, holds the project path.
// Name: the project folder's basename. With --opt names=title, the recorded `summary` first.
// Unknown format: a file that is no session at all (a .json without a messages list, a .jsonl with no metadata or message line,
// a checkpoint that is neither an array nor has a history list) is skipped and reported once, with its version field when it has one.
//
// Uncertain: the real chats folder on this machine is empty, so nothing here was checked against real logs; the shapes follow
// the source and synthetic fixtures. Unknown message types and fields are skipped.
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { unknownFormats, versionOf } from "./unknown.js";

const EDIT_TOOLS = /^(write_file|replace|edit|edit_file|write_new_file|insert|create_file|apply_patch|smart_edit)$/;
const SHELL_TOOLS = /^(run_shell_command|shell|execute_bash|bash)$/;

async function projectName(projectDir) {
  let name = basename(projectDir);
  try {
    const root = (await readFile(join(projectDir, ".project_root"), "utf8")).trim();
    if (root) name = basename(root);
  } catch { /* no .project_root */ }
  return /^[0-9a-f]{32,}$/i.test(name) ? "Gemini" : name;
}

export default {
  name: "gemini",
  description: "Gemini CLI sessions (~/.gemini/tmp/<project>/chats/session-*.jsonl and checkpoint-*.json)",
  defaultPath: "~/.gemini/tmp",
  merit: "prs_merged*5 + prs_opened*2 + commits + edits/20 + hours/4",
  async sessions(dir, ctx) {
    const sessions = [];
    const names = new Map();
    const unknown = unknownFormats("gemini");
    for (const file of await ctx.files(dir, /(session-[^/]*\.jsonl?|checkpoint[^/]*\.json)$/)) {
      try {
        const projectDir = file.includes("/chats/") ? file.slice(0, file.lastIndexOf("/chats/")) : dirname(file);
        if (!names.has(projectDir)) names.set(projectDir, await projectName(projectDir));
        const name = names.get(projectDir);
        const s = /checkpoint/.test(basename(file)) ? await checkpoint(file, name, ctx, unknown) : await chat(file, name, ctx, unknown);
        if (s) sessions.push(s);
      } catch (e) { ctx.log(`skipping ${basename(file)}: ${e.message}`); }
    }
    unknown.finish(ctx);
    return sessions;
  },
};

const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);

/** The text of a message's content: a string, one part, or a list of parts. Parts that are not text give "". */
function textOf(content) {
  if (typeof content === "string") return content;
  const parts = Array.isArray(content) ? content : content ? [content] : [];
  return parts.map((p) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : "")).join("");
}

/** The CLI's own test (isIgnoredUserContent) for a user message that is not a real prompt. */
function isPrompt(content) {
  const text = textOf(content).trim();
  return text !== "" && !/^[/?]/.test(text) && !text.startsWith("<session_context>") && !text.startsWith("<hook_context>");
}

async function chat(file, fallbackName, ctx, unknown) {
  let meta = {}, messages = new Map(), known = false;
  const put = (m) => { if (isObject(m) && typeof m.id === "string") messages.set(m.id, m); };
  if (file.endsWith(".json")) {
    const doc = JSON.parse(await readFile(file, "utf8"));
    if (!isObject(doc) || !Array.isArray(doc.messages)) { unknown.add(versionOf(doc)); return null; }
    known = true; meta = doc;
    doc.messages.forEach((m, i) => { if (isObject(m)) messages.set(typeof m.id === "string" ? m.id : `#${i}`, m); });
  } else {
    let firstVersion, any = false;
    for await (const r of ctx.lines(file)) {
      if (!isObject(r)) continue;
      any = true;
      firstVersion ??= versionOf(r);
      if (typeof r.$rewindTo === "string") {
        known = true;
        if (messages.has(r.$rewindTo)) { let hit = false; for (const id of [...messages.keys()]) { hit ||= id === r.$rewindTo; if (hit) messages.delete(id); } }
        else messages.clear();
      } else if (isObject(r.$set)) {
        known = true;
        const { messages: legacy, ...rest } = r.$set;
        Object.assign(meta, rest);
        if (Array.isArray(legacy)) { messages.clear(); legacy.forEach(put); }
      } else if (isObject(r.$patch)) {
        known = true;
        for (const id of Array.isArray(r.$patch.removeIds) ? r.$patch.removeIds : []) messages.delete(id);
      } else if (typeof r.id === "string") { known = true; put(r); }
      else if (typeof r.sessionId === "string") { known = true; Object.assign(meta, r); }
    }
    if (!known) { if (any) unknown.add(firstVersion); return null; }       // an empty file is not a format problem
  }
  unknown.recognized();
  const t = ctx.track({ name: (ctx.options.names === "title" && typeof meta.summary === "string" && meta.summary.trim()) || fallbackName });
  if (meta.startTime) t.at(meta.startTime);
  if (meta.lastUpdated) t.at(meta.lastUpdated);
  let tokens = 0, model;
  for (const m of messages.values()) {
    t.at(m.timestamp);
    if (m.type === "user" && isPrompt(m.content)) t.count("prompts", 1, m.timestamp);
    if (m.type !== "gemini") continue;
    if (typeof m.model === "string") model = m.model;
    const tk = m.tokens;
    if (typeof tk?.total === "number") tokens += tk.total;
    else if (isObject(tk)) tokens += (Number(tk.input) || 0) + (Number(tk.output) || 0);
    for (const c of Array.isArray(m.toolCalls) ? m.toolCalls : []) {
      if (!isObject(c)) continue;
      const at = c.timestamp ?? m.timestamp;
      t.count("tool_calls", 1, at);
      if (EDIT_TOOLS.test(c.name || "")) t.count("edits", 1, at);
      if (SHELL_TOOLS.test(c.name || "")) {
        t.count("commands", 1, at);
        const ev = ctx.shellEvents(c.args?.command);
        for (const k of ["commits", "prs_opened", "prs_merged", "tests"]) if (ev[k]) t.count(k, ev[k], at);
      }
    }
  }
  if (model) t.set("model", model);
  if (tokens) t.count("tokens", tokens);
  return t.session();
}

async function checkpoint(file, name, ctx, unknown) {
  const doc = JSON.parse(await readFile(file, "utf8"));
  const history = Array.isArray(doc) ? doc : isObject(doc) && Array.isArray(doc.history) ? doc.history : null;
  if (!history) { unknown.add(versionOf(doc)); return null; }
  unknown.recognized();
  const mtime = (await stat(file)).mtimeMs, t = ctx.track({ name });
  t.at(mtime);
  for (const turn of history) {
    const parts = Array.isArray(turn?.parts) ? turn.parts : [];
    if (turn?.role === "user" && parts.some((p) => typeof p?.text === "string") && isPrompt(parts)) t.count("prompts", 1, mtime);
    for (const p of parts) {
      if (!p?.functionCall) continue;
      t.count("tool_calls", 1, mtime);
      if (EDIT_TOOLS.test(p.functionCall.name || "")) t.count("edits", 1, mtime);
      if (SHELL_TOOLS.test(p.functionCall.name || "")) t.count("commands", 1, mtime);
    }
  }
  return t.session();
}
