// Adapter for the Gemini CLI: ~/.gemini/tmp/<project>/chats/session-*.jsonl  (older versions: session-*.json)
//
// Format assumed, from the public Gemini CLI source (chatRecordingService / chatRecordingTypes):
//   .jsonl: line 1 is metadata { sessionId, projectHash, startTime, lastUpdated, kind? };
//           later lines are messages { id, timestamp, type: "user" | "gemini" | "info" | "error" | "warning", content,
//             toolCalls?: [{ id, name, args, status, timestamp }], tokens?: { input, output, cached, thoughts, tool, total }, model? }
//           and bookkeeping lines { $set: {...} } (may carry summary), { $rewindTo: <message id> } (drops that message and
//           all after it), { $patch: ... } (ignored).
//   .json (older): one object { sessionId, startTime, lastUpdated, messages: [...], summary? }.
//   checkpoint-*.json (from "/chat save"): an array of { role, parts: [{ text | functionCall | functionResponse }] } with no times;
//           the file's modified time stands in for activity, and only tool calls are counted.
// A project's folder name under tmp/ is either a hash or a name; "<folder>/.project_root", when present, holds the project path.
// The session title is the recorded `summary`, else the project folder's basename.
//
// Uncertain: the real chats folder on this machine is empty, so nothing here was checked against real logs. The shape
// follows the source of one recent Gemini CLI version; field names may differ in other versions, and unknown lines are skipped.
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

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
    for (const file of await ctx.files(dir, /(session-[^/]*\.jsonl?|checkpoint[^/]*\.json)$/)) {
      try {
        const projectDir = file.includes("/chats/") ? file.slice(0, file.lastIndexOf("/chats/")) : dirname(file);
        if (!names.has(projectDir)) names.set(projectDir, await projectName(projectDir));
        const name = names.get(projectDir);
        const s = /checkpoint/.test(basename(file)) ? await checkpoint(file, name, ctx) : await chat(file, name, ctx);
        if (s) sessions.push(s);
      } catch (e) { ctx.log(`skipping ${basename(file)}: ${e.message}`); }
    }
    return sessions;
  },
};

async function chat(file, fallbackName, ctx) {
  let meta = {}, messages = [];
  if (file.endsWith(".json")) {
    const doc = JSON.parse(await readFile(file, "utf8"));
    meta = doc; messages = Array.isArray(doc.messages) ? doc.messages : [];
  } else {
    for await (const r of ctx.lines(file)) {
      if (!r || typeof r !== "object") continue;
      if (typeof r.$rewindTo === "string") { const i = messages.findIndex((m) => m.id === r.$rewindTo); if (i >= 0) messages.length = i; }
      else if (r.$set && typeof r.$set === "object") { const { messages: legacy, ...rest } = r.$set; Object.assign(meta, rest); if (Array.isArray(legacy) && !messages.length) messages = legacy; }
      else if (r.$patch) continue;
      else if (typeof r.id === "string" && typeof r.type === "string") messages.push(r);
      else if (typeof r.sessionId === "string") Object.assign(meta, r);
    }
  }
  const t = ctx.track({ name: (typeof meta.summary === "string" && meta.summary.trim()) || fallbackName });
  if (meta.startTime) t.at(meta.startTime);
  if (meta.lastUpdated) t.at(meta.lastUpdated);
  let tokens = 0, model;
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    t.at(m.timestamp);
    if (m.type === "user") t.count("prompts", 1, m.timestamp);
    if (m.type !== "gemini") continue;
    if (typeof m.model === "string") model = m.model;
    if (typeof m.tokens?.total === "number") tokens += m.tokens.total;
    for (const c of Array.isArray(m.toolCalls) ? m.toolCalls : []) {
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

async function checkpoint(file, name, ctx) {
  const history = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(history)) return null;
  const mtime = (await stat(file)).mtimeMs, t = ctx.track({ name });
  t.at(mtime);
  for (const turn of history) {
    if (turn?.role === "user" && Array.isArray(turn.parts) && turn.parts.some((p) => typeof p?.text === "string")) t.count("prompts", 1, mtime);
    for (const p of Array.isArray(turn?.parts) ? turn.parts : []) {
      if (!p?.functionCall) continue;
      t.count("tool_calls", 1, mtime);
      if (EDIT_TOOLS.test(p.functionCall.name || "")) t.count("edits", 1, mtime);
      if (SHELL_TOOLS.test(p.functionCall.name || "")) t.count("commands", 1, mtime);
    }
  }
  return t.session();
}
