// Claude Code: the session transcripts in ~/.claude/projects/<project>/<session>.jsonl.
//
// One transcript file is one agent life. Its name: the session's name (`claude -n`, /rename), else the
// project folder's name, so unnamed sessions of one project become generations of one lineage.
//   --opt names=project   always the project folder's name
//   --opt names=session   only session names; unnamed sessions are "Unnamed"
// Subagent transcripts (<session>/subagents/*.jsonl) count as their parent's work: a "subagents" stat.
// Live sessions are read from ~/.claude/sessions/<pid>.json when that folder is next to the projects folder.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
    // A session continued in another project folder, or a fork, copies earlier messages into a new transcript.
    // Read the oldest transcripts first and count each message (by its uuid) once; files that share a session id
    // are one agent.
    files.sort((a, b) => created(a) - created(b) || a.localeCompare(b));
    const seen = new Set(), prsSeen = new Set(), bySession = new Map();
    for (const file of files) {
      const id = basename(file, ".jsonl");
      if (!bySession.has(id)) bySession.set(id, newState(ctx));
      await readInto(bySession.get(id), file, ctx, seen, prsSeen);
    }
    const out = [];
    for (const [id, st] of bySession) { const s = finish(st, id, ctx, live); if (s) out.push(s); }
    ctx.log(`${files.length} transcripts read, ${bySession.size} sessions`);
    return out;
  },
};

function created(file) {
  try { const st = statSync(file); return st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs; } catch { return 0; }
}

function newState(ctx) {
  return { t: ctx.track({ name: "" }), agentName: undefined, title: undefined, cwd: undefined, folder: undefined, cost: 0, lines: 0,
    prs: 0, models: {}, pending: new Map(), subagentDirs: new Set() };
}

async function readInto(st, file, ctx, seen, prsSeen) {
  const { t, models, pending } = st;
  st.folder ??= dirname(file);
  st.subagentDirs.add(join(dirname(file), basename(file, ".jsonl"), "subagents"));
  for await (const d of ctx.lines(file, WANTED)) {
    switch (d.type) {
      case "agent-name": if (d.agentName) st.agentName = d.agentName; break;
      case "custom-title": if (d.customTitle) st.title = d.customTitle; break;
      case "pr-link": if (d.prUrl && !prsSeen.has(d.prUrl)) { prsSeen.add(d.prUrl); st.prs++; t.count("prs_opened", 1, d.timestamp); } break;
      case "cost-state":                               // per process; a continued session has one per file
        if (typeof d.totalCostUSD === "number") st.cost = Math.max(st.cost, d.totalCostUSD);
        if (typeof d.totalLinesAdded === "number") st.lines = Math.max(st.lines, d.totalLinesAdded);
        break;
      case "user": {
        if (d.uuid) { if (seen.has(d.uuid)) break; seen.add(d.uuid); }
        st.cwd ??= d.cwd;
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
        if (d.uuid) { if (seen.has(d.uuid)) break; seen.add(d.uuid); }
        st.cwd ??= d.cwd;
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
            if (ev.prs_opened) { t.count("prs_opened_cmd", ev.prs_opened, d.timestamp); counted.prs_opened_cmd = ev.prs_opened; }
            if (Object.keys(counted).length) pending.set(x.id, counted);
          }
        }
        break;
      }
    }
  }
}

function finish(st, sessionId, ctx, live) {
  const { t } = st;
  if (t.empty) return null;
  const project = st.cwd ? basename(st.cwd) : projectFromFolder(basename(st.folder || ""));
  const mode = ctx.options.names;
  const name = mode === "project" ? project : st.agentName || st.title || (mode === "session" ? "Unnamed" : project);
  const model = Object.entries(st.models).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (model) t.set("model", model);
  if (st.cost) t.count("cost_usd", st.cost);
  if (st.lines) t.count("lines_added", st.lines);
  let subagents = 0;
  for (const dir of st.subagentDirs) if (existsSync(dir)) subagents += readdirSync(dir).filter((f) => f.endsWith(".jsonl")).length;
  if (subagents) t.count("subagents", subagents);
  const s = t.session({ name: name || "Unnamed", ...(live ? { alive: live.has(sessionId) } : {}) });
  // `gh pr create` counts only when the session has no pr-link lines (those are exact).
  for (const bag of [s.stats, ...Object.values(s.days)]) {
    if (bag.prs_opened_cmd && !st.prs) bag.prs_opened = (bag.prs_opened || 0) + bag.prs_opened_cmd;
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
