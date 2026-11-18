// Claude Code: the session transcripts in ~/.claude/projects/<project>/<session>.jsonl.
//
// One transcript file is one agent life. Its name: the session's name (`claude -n`, /rename), else the
// project folder's name, so unnamed sessions of one project become generations of one lineage.
//   --opt names=project   always the project folder's name
//   --opt names=session   only session names; unnamed sessions are "Unnamed"
// Subagent transcripts (<session>/subagents/*.jsonl) count as their parent's work: a "subagents" stat.
// Live sessions are read from ~/.claude/sessions/<pid>.json when that folder is next to the projects folder.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const WANTED = ['"type":"user"', '"type":"assistant"', '"type":"agent-name"', '"type":"custom-title"', '"type":"pr-link"', '"type":"cost-state"'];

export default {
  name: "claude-code",
  description: "Claude Code transcripts (~/.claude/projects). --opt names=project|session",
  defaultPath: process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, "projects") : "~/.claude/projects",
  merit: "prs_merged*5 + prs_opened*2 + commits + edits/20 + hours/4",
  metrics: [
    { key: "prs_merged", label: "PRs merged" }, { key: "commits", label: "Commits" }, { key: "edits", label: "File edits" },
    { key: "hours", label: "Hours worked", unit: " h" }, { key: "prompts", label: "Prompts" }, { key: "cost_usd", label: "Cost", unit: " USD" },
  ],
  async sessions(root, ctx) {
    const live = liveSessions(join(dirname(root), "sessions"));
    const files = (await ctx.files(root, /\.jsonl$/, { maxDepth: 1 })).filter((f) => !f.includes(`${"/"}subagents${"/"}`));
    const out = [];
    for (const file of files) {
      const s = await readSession(file, ctx, live);
      if (s) out.push(s);
    }
    ctx.log(`${files.length} transcripts read`);
    return out;
  },
};

async function readSession(file, ctx, live) {
  const t = ctx.track({ name: "" });
  let sessionId = basename(file, ".jsonl"), agentName, title, cwd, cost;
  const prs = new Set(), models = {}, pending = new Map();
  for await (const d of ctx.lines(file, WANTED)) {
    switch (d.type) {
      case "agent-name": if (d.agentName) agentName = d.agentName; break;
      case "custom-title": if (d.customTitle) title = d.customTitle; break;
      case "pr-link": if (d.prUrl && !prs.has(d.prUrl)) { prs.add(d.prUrl); t.count("prs_opened", 1, d.timestamp); } break;
      case "cost-state": cost = d; break;
      case "user": {
        if (d.sessionId) sessionId = d.sessionId;
        cwd ??= d.cwd;
        t.at(d.timestamp);
        const c = d.message?.content;
        const isPrompt = !d.isMeta && !d.isSidechain && (typeof c === "string" || (Array.isArray(c) && c.some((x) => x?.type === "text") && !c.some((x) => x?.type === "tool_result")));
        if (isPrompt) t.count("prompts", 1, d.timestamp);
        // A failed commit or merge does not count: take back what its tool call added.
        if (Array.isArray(c)) for (const x of c) {
          if (x?.type === "tool_result" && x.is_error && pending.has(x.tool_use_id)) {
            for (const [k, n] of Object.entries(pending.get(x.tool_use_id))) t.count(k, -n, d.timestamp);
          }
          if (x?.type === "tool_result") pending.delete(x.tool_use_id);
        }
        break;
      }
      case "assistant": {
        cwd ??= d.cwd;
        t.at(d.timestamp);
        const m = d.message || {};
        if (m.model && m.model !== "<synthetic>") models[m.model] = (models[m.model] || 0) + 1;
        for (const x of Array.isArray(m.content) ? m.content : []) {
          if (x?.type !== "tool_use") continue;
          t.count("tool_calls", 1, d.timestamp);
          if (EDIT_TOOLS.has(x.name)) t.count("edits", 1, d.timestamp);
          if (x.name === "Bash" && x.input?.command) {
            t.count("commands", 1, d.timestamp);
            const ev = ctx.shellEvents(x.input.command);
            const counted = {};
            for (const k of ["commits", "prs_merged", "tests"]) if (ev[k]) { t.count(k, ev[k], d.timestamp); counted[k] = ev[k]; }
            // PRs opened come from pr-link lines when the transcript has them; else from `gh pr create`.
            if (ev.prs_opened && !prs.size) { t.count("prs_opened_cmd", ev.prs_opened, d.timestamp); counted.prs_opened_cmd = ev.prs_opened; }
            if (Object.keys(counted).length) pending.set(x.id, counted);
          }
        }
        break;
      }
    }
  }
  if (t.empty) return null;
  const project = cwd ? basename(cwd) : projectFromFolder(basename(dirname(file)));
  const mode = ctx.options.names;
  const name = mode === "project" ? project : agentName || title || (mode === "session" ? "Unnamed" : project);
  const model = Object.entries(models).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (model) t.set("model", model);
  if (cost) {
    if (typeof cost.totalCostUSD === "number") t.count("cost_usd", cost.totalCostUSD);
    if (typeof cost.totalLinesAdded === "number") t.count("lines_added", cost.totalLinesAdded);
  }
  const sub = join(dirname(file), sessionId, "subagents");
  if (existsSync(sub)) t.count("subagents", readdirSync(sub).filter((f) => f.endsWith(".jsonl")).length);
  const s = t.session({ name: name || "Unnamed", ...(live ? { alive: live.has(sessionId) } : {}) });
  // Fold `gh pr create` counts into prs_opened when there were no pr-link lines.
  for (const bag of [s.stats, ...Object.values(s.days)]) {
    if (bag.prs_opened_cmd) { bag.prs_opened = (bag.prs_opened || 0) + bag.prs_opened_cmd; }
    delete bag.prs_opened_cmd;
    for (const k of ["commits", "prs_merged", "tests"]) if (bag[k] <= 0) delete bag[k];
  }
  return s;
}

/** The session ids of running Claude Code processes, or null when this is not a live ~/.claude. */
function liveSessions(dir) {
  if (!existsSync(dir)) return null;
  const live = new Set();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const s = JSON.parse(readFileSync(join(dir, f), "utf8"));
      process.kill(s.pid, 0);
      if (s.sessionId) live.add(s.sessionId);
    } catch { /* gone, or not ours */ }
  }
  return live;
}

/** "-Users-ada-code-my-app" → "my-app" (a guess: the folder name is the path with "/" made "-"). */
function projectFromFolder(folder) {
  const parts = folder.split("-").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "Unnamed";
}
