// Shared by the trace adapters (openai-agents, langsmith, langfuse): reading exported JSON / JSON Lines, and deciding
// what a tool call did. Not an adapter itself; it is not in the registry.
import { readFile } from "node:fs/promises";

const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
export { isObject };

/**
 * The records of one exported file. A .json file is one value; a .jsonl/.ndjson file is one value per line. Arrays are
 * flattened, and an object that wraps a list under one of `wrap` ({ "data": [...] }, as the tools' list APIs return) is
 * replaced by that list. Returns null when the file cannot be parsed at all.
 */
export async function recordsOf(file, wrap = ["data"]) {
  let text;
  try { text = await readFile(file, "utf8"); } catch { return null; }
  const values = [];
  if (/\.(jsonl|ndjson)$/i.test(file)) {
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try { values.push(JSON.parse(line)); } catch { /* a torn line */ }
    }
    if (!values.length && text.trim()) return null;
  } else {
    try { values.push(JSON.parse(text)); } catch { return null; }
  }
  const out = [];
  const walk = (v, depth) => {
    if (Array.isArray(v)) { for (const x of v) walk(x, depth); return; }
    if (!isObject(v)) return;
    if (depth < 3) for (const k of wrap) if (Array.isArray(v[k]) && !("object" in v) && !("run_type" in v)) { walk(v[k], depth + 1); return; }
    out.push(v);
  };
  for (const v of values) walk(v, 0);
  return out;
}

/** The version a file states about itself, if any. */
export function versionOfFile(records) {
  for (const r of records || []) for (const k of ["version", "schema_version", "schemaVersion", "_v"]) if (typeof r?.[k] === "string" || typeof r?.[k] === "number") return r[k];
  return undefined;
}

export const EDIT_TOOL = /^(apply_patch|edit|edit_file|write|write_file|create_file|create_new_file|str_replace\w*|multi_?edit|update_file|replace)$/i;
export const SHELL_TOOL = /^(shell|bash|sh|zsh|local_shell|run_shell_command|run_terminal_command|run_command|execute_command|execute_bash|exec|exec_command|terminal|computer_shell)$/i;

/** The shell command in a tool call's input (an object, or JSON text), or "". Only the command is read, nothing else. */
export function commandOf(input) {
  let v = input;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return ""; } }
  if (!isObject(v)) return "";
  if (isObject(v.input)) v = v.input;   // some tools nest the arguments
  const c = v.command ?? v.cmd;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.length >= 3 && /(^|\/)(ba|z|da)?sh$/.test(String(c[0])) && /^-\w*c$/.test(String(c[1])) ? String(c[2]) : c.map(String).join(" ");
  return "";
}

/** Count one tool call on a tracker: tool_calls, and edits, commands, commits, prs and tests when its name and input say so. */
export function countTool(t, ctx, name, input, at) {
  t.count("tool_calls", 1, at);
  const n = typeof name === "string" ? name : "";
  if (SHELL_TOOL.test(n)) {
    t.count("commands", 1, at);
    const ev = ctx.shellEvents(commandOf(input));
    for (const k of ["commits", "prs_opened", "prs_merged", "tests"]) if (ev[k]) t.count(k, ev[k], at);
  } else if (EDIT_TOOL.test(n)) t.count("edits", 1, at);
}

/** Token counts from the usual field names. */
export function tokensOf(u) {
  if (!isObject(u)) return 0;
  const total = u.total_tokens ?? u.totalTokens ?? u.total;
  if (typeof total === "number") return total;
  const a = u.input_tokens ?? u.prompt_tokens ?? u.promptTokens ?? u.input ?? 0, b = u.output_tokens ?? u.completion_tokens ?? u.completionTokens ?? u.output ?? 0;
  return (typeof a === "number" ? a : 0) + (typeof b === "number" ? b : 0);
}

/** An ISO time without a zone is UTC in the trace tools' exports (LangSmith writes them so); say so, or Node reads it as local time. */
export function utc(t) {
  return typeof t === "string" && /^\d{4}-\d\d-\d\d[T ][\d:.]+$/.test(t) ? t.replace(" ", "T") + "Z" : t;
}
