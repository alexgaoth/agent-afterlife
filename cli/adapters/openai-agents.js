// Adapter for OpenAI Agents SDK traces (openai/openai-agents-python), as exported to a file.
//
// Format, read from openai/openai-agents-python @ 91fb508a8931 (2026-11-17), src/agents/tracing/{traces,spans,span_data}.py:
//   Trace.export()  { object: "trace", id, workflow_name, group_id, metadata }                        (no times)
//   Span.export()   { object: "trace.span", id, trace_id, parent_id, started_at, ended_at (ISO), error,
//                     span_data: { type: "agent" | "function" | "generation" | "response" | "handoff" | "guardrail" | "custom" | "mcp_tools" | ..., ... } }
//     agent       { name, handoffs, tools, output_type }
//     function    { name, input (JSON text), output, mcp_data }
//     generation  { model, usage: { input_tokens, output_tokens }, input, output, model_config }
//     response    { response_id, usage }
//     handoff     { from_agent, to_agent }
// The SDK has no file exporter of its own; the documented way is a custom TracingProcessor (or exporter) that writes these export()
// dictionaries. This adapter reads such a file: JSON (one object, a list, or the backend's { "data": [...] } batch) or JSON Lines, or a
// folder of them. Prompts, outputs and generation inputs are never read; only a shell function's "command" goes to shellEvents.
// Life: one per TRACE (one workflow run), not per agent span. A trace is the unit the SDK names and times as one run; the agents in it
// (handoffs) work as one team, and splitting by agent span name would cut a run into lives that have no start or end of their own.
// Name: the trace's workflow_name (the SDK's default is "Agent workflow"); without a trace record, the first agent span's name; else "Agent".
// Counts: prompts = 1 per trace (one run = one request to the workflow); tool_calls = function spans; edits and commands by the function's
// name (apply_patch, edit_file, ... ; shell, bash, ...); handoffs; generations; tokens from generation and response usage; model.
// Merit: tool_calls/10 + hours/4 (no commits or PRs unless a shell function ran them: those add prs_merged*5 + prs_opened*2 + commits).
// Unknown format: a file with no trace and no span record (by "object", or by span_data + trace_id) is skipped and reported once.
//
// How sure: the export dictionaries are read from the source, so the field names are firm. How people write them to a file is theirs
// to choose (one JSON per line is assumed to be the common case), so the container is handled loosely. Medium-high.
import { basename } from "node:path";
import { unknownFormats } from "./unknown.js";
import { recordsOf, versionOfFile, isObject, countTool, tokensOf, utc } from "./trace-util.js";

const isSpan = (r) => r.object === "trace.span" || (isObject(r.span_data) && typeof r.trace_id === "string");
const isTrace = (r) => r.object === "trace";

export default {
  name: "openai-agents",
  description: "OpenAI Agents SDK traces exported as JSON / JSON Lines (trace and trace.span records); a file or a folder. One life per trace",
  merit: "prs_merged*5 + prs_opened*2 + commits + tool_calls/10 + hours/4",
  async sessions(path, ctx) {
    const unknown = unknownFormats("openai-agents");
    const traces = new Map();   // trace id -> { name, spans: [] }
    const get = (id) => { if (!traces.has(id)) traces.set(id, { name: undefined, spans: [] }); return traces.get(id); };
    for (const file of await ctx.files(path, /\.(jsonl?|ndjson)$/i)) {
      const records = await recordsOf(file, ["data", "traces", "spans"]);
      if (!records || !records.some((r) => isTrace(r) || isSpan(r))) { unknown.add(versionOfFile(records)); continue; }
      unknown.recognized();
      for (const r of records) {
        if (isTrace(r) && typeof r.id === "string") {
          const t = get(r.id);
          if (typeof r.workflow_name === "string" && r.workflow_name) t.name = r.workflow_name;
          if (Array.isArray(r.spans)) for (const s of r.spans) if (isObject(s) && isSpan(s)) get(r.id).spans.push(s);
        } else if (isSpan(r)) get(r.trace_id).spans.push(r);
      }
    }
    const sessions = [];
    for (const [id, trace] of traces) {
      try {
        const spans = trace.spans.filter((s) => isObject(s.span_data));
        spans.sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at) || 0);
        const agent = spans.find((s) => s.span_data.type === "agent" && typeof s.span_data.name === "string");
        const t = ctx.track({ name: trace.name || agent?.span_data.name || "Agent" });
        let tokens = 0, model;
        for (const s of spans) {
          const d = s.span_data, start = utc(s.started_at), end = utc(s.ended_at);
          t.at(start).at(end);
          if (d.type === "function") countTool(t, ctx, d.name, d.input, start);
          else if (d.type === "handoff") t.count("handoffs", 1, start);
          else if (d.type === "generation" || d.type === "response") {
            t.count("generations", 1, start);
            tokens += tokensOf(d.usage);
            if (d.type === "generation" && typeof d.model === "string") model = d.model;
          }
        }
        if (spans.length) t.count("prompts", 1, utc(spans[0].started_at));
        if (model) t.set("model", model);
        if (tokens) t.count("tokens", tokens);
        const s = t.session();
        if (s) sessions.push(s);
      } catch (e) { ctx.log(`skipping trace ${basename(String(id))}: ${e.message}`); }
    }
    unknown.finish(ctx);
    return sessions;
  },
};
