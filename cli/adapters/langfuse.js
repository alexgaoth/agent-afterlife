// Adapter for Langfuse trace exports (langfuse/langfuse): JSON from the public API (GET /api/public/traces, /traces/{id}, /observations).
//
// Format, read from langfuse/langfuse @ 6dfeb6049b8f (2026-11-17), web/src/features/public-api/types/{traces,observations}.ts
// and web/public/generated/api/openapi.yml:
//   Trace        { id, timestamp (ISO), name, tags: [..], sessionId, userId, release, version, environment, latency (seconds), totalCost,
//                  observations: [id, ...] in a list response, or [Observation, ...] in GET /traces/{id}, scores, input, output, metadata }
//   Observation { id, traceId, parentObservationId, type: "GENERATION" | "SPAN" | "EVENT" | "AGENT" | "TOOL" | "CHAIN" | "RETRIEVER" | ...,
//                  name, startTime, endTime (ISO), model, usage: { input, output, total } or usageDetails: { input, output, total },
//                  calculatedTotalCost (or totalCost, costDetails), latency, level, input, output }
// The file is any of: one trace, a list of traces, a page { data: [...], meta }, a list of observations, or JSON Lines of those; a folder of
// such files also works. Observations are joined to their trace by traceId, or are taken from trace.observations when those are objects.
// Inputs, outputs and metadata are never read, except a shell tool's "command" (for commits, PRs and tests).
// Life: one per TRACE. Name: the trace's name; with --opt names=tag, its first tag; else the first AGENT observation's name, else the
// first tag, else "Langfuse".
// Counts: prompts = 1 per trace; tool_calls = TOOL observations (the typed ones; older SDKs write tools as SPAN and cannot be told apart);
// edits and commands by the tool's name; generations = GENERATION observations; tokens and cost_usd from GENERATION observations
// (parents do not add them again); model from the last GENERATION's model.
// Times: the trace timestamp, its latency, and every observation's start and end. A trace listed without observations has only its
// timestamp plus latency, so its hours are the latency.
// Merit: tool_calls/10 + hours/4 (plus the PR and commit terms, which count when a shell tool ran them).
// Unknown format: a file with neither a trace nor an observation record (an object with id and timestamp, or with startTime and type)
// is skipped and reported once.
//
// How sure: the field names come from the API's own types and OpenAPI file. List exports carry only observation ids, so detail exports
// (GET /traces/{id}) or /observations are better. Medium-high.
import { unknownFormats } from "./unknown.js";
import { recordsOf, versionOfFile, isObject, countTool } from "./trace-util.js";

const isObs = (r) => typeof r.startTime === "string" && typeof r.type === "string";
const isTrace = (r) => typeof r.id === "string" && typeof r.timestamp === "string" && !("startTime" in r);

export default {
  name: "langfuse",
  description: "Langfuse trace exports from the public API (traces, traces with observations, observations; JSON or JSON Lines); a file or a folder. One life per trace. --opt names=tag",
  merit: "prs_merged*5 + prs_opened*2 + commits + tool_calls/10 + hours/4",
  async sessions(path, ctx) {
    const unknown = unknownFormats("langfuse");
    const traces = new Map(), obs = new Map();   // trace id -> trace record; trace id -> Map(observation id -> observation)
    const addObs = (o, traceId) => {
      const id = traceId ?? o.traceId ?? "";
      if (!obs.has(id)) obs.set(id, new Map());
      obs.get(id).set(String(o.id ?? obs.get(id).size), o);
    };
    for (const file of await ctx.files(path, /\.(jsonl?|ndjson)$/i)) {
      const records = await recordsOf(file, ["data"]);
      if (!records || !records.some((r) => isObs(r) || isTrace(r))) { unknown.add(versionOfFile(records)); continue; }
      unknown.recognized();
      for (const r of records) {
        if (isObs(r)) addObs(r);
        else if (isTrace(r)) {
          traces.set(r.id, r);
          if (Array.isArray(r.observations)) for (const o of r.observations) if (isObject(o) && isObs(o)) addObs(o, r.id);
        }
      }
    }
    const sessions = [];
    for (const id of new Set([...traces.keys(), ...obs.keys()])) {
      const trace = traces.get(id), list = [...(obs.get(id)?.values() ?? [])];
      list.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime) || 0);
      const agent = list.find((o) => o.type === "AGENT" && typeof o.name === "string")?.name;
      const root = list.find((o) => !o.parentObservationId && typeof o.name === "string")?.name;
      const tag = trace?.tags?.[0];
      const t = ctx.track({ name: (ctx.options.names === "tag" && typeof tag === "string" && tag) || (typeof trace?.name === "string" && trace.name) || agent || root || (typeof tag === "string" && tag) || "Langfuse" });
      if (trace) {
        t.at(trace.timestamp);
        if (typeof trace.latency === "number" && trace.latency > 0) t.at(Date.parse(trace.timestamp) + trace.latency * 1000);
      }
      let tokens = 0, cost = 0, model;
      for (const o of list) {
        t.at(o.startTime).at(o.endTime);
        if (o.type === "TOOL") countTool(t, ctx, o.name, o.input, o.startTime);
        else if (o.type === "GENERATION") {
          t.count("generations", 1, o.startTime);
          const u = isObject(o.usageDetails) ? o.usageDetails : isObject(o.usage) ? o.usage : {};
          tokens += Number(u.total ?? u.total_tokens) || (Number(u.input ?? u.prompt_tokens) || 0) + (Number(u.output ?? u.completion_tokens) || 0);
          cost += Number(o.calculatedTotalCost ?? o.totalCost ?? o.costDetails?.total) || 0;
          if (typeof o.model === "string" && o.model) model = o.model;
        }
      }
      t.count("prompts", 1, trace?.timestamp ?? list[0]?.startTime);
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
