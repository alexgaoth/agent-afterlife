// Adapter for LangSmith run exports (langchain-ai/langsmith-sdk): the JSON the SDK's `Client.list_runs(...)` returns, written to a file.
//
// Format, read from langchain-ai/langsmith-sdk @ 290f06a628df (2026-11-17), python/langsmith/schemas.py (RunBase, Run, RunTypeEnum):
//   Run  { id, trace_id, parent_run_id, name, run_type: "llm" | "chain" | "tool" | "retriever" | "embedding" | "prompt" | "parser",
//          start_time, end_time (ISO, UTC, often without "Z"), error, tags: [..], inputs, outputs,
//          extra: { metadata: { ls_model_name, ls_provider, ... }, invocation_params: { model | model_name, ... } },
//          prompt_tokens, completion_tokens, total_tokens, total_cost, child_runs?: [Run], status }
// The file is a JSON array of runs, { "runs": [...] } / { "data": [...] }, or JSON Lines (one run per line); a folder of such files also
// works. Nested `child_runs` are flattened. Runs are grouped into traces by trace_id (else by following parent_run_id to the root).
// Inputs and outputs are never read, except a shell tool's "command" (for commits, PRs and tests).
// Life: one per TRACE (a root run and all its descendants). Name: the root run's name (the agent or chain name you gave it);
// with --opt names=tag, the root run's first tag. "LangSmith" when neither exists.
// Counts: prompts = 1 per trace (one root request); tool_calls = tool runs; edits and commands by the tool's name (edit_file, shell, ...);
// generations = llm runs; tokens and cost_usd from llm runs only (a chain's totals already add up its children, so they are not summed);
// model from extra.metadata.ls_model_name or invocation_params.
// Merit: tool_calls/10 + hours/4 (plus the PR and commit terms, which count when a shell tool ran them).
// Unknown format: a file with no record that has run_type and a start_time is skipped and reported once.
//
// How sure: the field names are read from the SDK's schema; I did not see an export written by someone's own script, so the container
// (array, wrapper key, lines) is handled loosely. Medium-high.
import { unknownFormats } from "./unknown.js";
import { recordsOf, versionOfFile, isObject, countTool, tokensOf, utc } from "./trace-util.js";

const isRun = (r) => typeof r.run_type === "string" && (typeof r.start_time === "string" || typeof r.start_time === "number");

export default {
  name: "langsmith",
  description: "LangSmith run exports (JSON array, { runs: [...] } or JSON Lines of runs); a file or a folder. One life per trace. --opt names=tag",
  merit: "prs_merged*5 + prs_opened*2 + commits + tool_calls/10 + hours/4",
  async sessions(path, ctx) {
    const unknown = unknownFormats("langsmith");
    const runs = new Map();
    const add = (r) => {
      if (!isObject(r) || !isRun(r)) return;
      const id = String(r.id ?? `${runs.size}`);
      if (!runs.has(id)) runs.set(id, r);
      if (Array.isArray(r.child_runs)) for (const c of r.child_runs) add({ ...c, trace_id: c?.trace_id ?? r.trace_id, parent_run_id: c?.parent_run_id ?? r.id });
    };
    for (const file of await ctx.files(path, /\.(jsonl?|ndjson)$/i)) {
      const records = await recordsOf(file, ["runs", "data"]);
      if (!records || !records.some(isRun)) { unknown.add(versionOfFile(records)); continue; }
      unknown.recognized();
      for (const r of records) add(r);
    }
    const rootOf = (r) => { let x = r, n = 0; while (x.parent_run_id && runs.has(String(x.parent_run_id)) && n++ < 100) x = runs.get(String(x.parent_run_id)); return String(x.id); };
    const traces = new Map();
    for (const r of runs.values()) {
      const key = String(r.trace_id ?? rootOf(r));
      if (!traces.has(key)) traces.set(key, []);
      traces.get(key).push(r);
    }
    const sessions = [];
    for (const list of traces.values()) {
      list.sort((a, b) => Date.parse(utc(a.start_time)) - Date.parse(utc(b.start_time)) || 0);
      const root = list.find((r) => !r.parent_run_id) || list[0];
      const tag = (list.find((r) => !r.parent_run_id && r.tags?.length) || root).tags?.[0];
      const t = ctx.track({ name: (ctx.options.names === "tag" && typeof tag === "string" && tag) || (typeof root.name === "string" && root.name) || (typeof tag === "string" && tag) || "LangSmith" });
      let tokens = 0, cost = 0, model;
      for (const r of list) {
        const start = utc(r.start_time), end = utc(r.end_time);
        t.at(start).at(end);
        if (r.run_type === "tool") countTool(t, ctx, r.name, r.inputs, start);
        else if (r.run_type === "llm") {
          t.count("generations", 1, start);
          tokens += typeof r.total_tokens === "number" ? r.total_tokens : tokensOf(r);
          cost += Number(r.total_cost) || 0;
          const m = r.extra?.metadata?.ls_model_name ?? r.extra?.invocation_params?.model ?? r.extra?.invocation_params?.model_name;
          if (typeof m === "string" && m) model = m;
        }
      }
      t.count("prompts", 1, utc(root.start_time));
      if (model) t.set("model", model);
      if (tokens) t.count("tokens", tokens);
      if (cost) t.count("cost_usd", Math.round(cost * 1e4) / 1e4);
      const s = t.session();
      if (s) sessions.push(s);
    }
    unknown.finish(ctx);
    return sessions;
  },
};
