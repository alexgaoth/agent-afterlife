// git: commits made by AI agents in local repositories. Works with any agent workflow that commits.
//
// A commit is an agent's when its author, or a trailer or footer in its message, names a known agent:
// "Co-authored-by: Claude", "Generated with Claude Code", "Name (aider)", "copilot-swe-agent[bot]", ...
// An agent's commits in one repository form one session until a gap of more than --opt gap=<hours> (3).
//   --opt by=author          every author is an agent, named by the author's name
//   --opt agent=<regex>=<N>  also count commits matching regex as agent N (";" between several)
//   --opt all=1              read every branch (git log --all), not only the checked-out one
// The path is a repository, or a folder whose sub-folders (two levels) are repositories. Default: ".".
import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { agentOf, credits, extraAgents } from "./agents.js";

const run = promisify(execFile);

export default {
  name: "git",
  description: "Commits by AI agents in local git repositories (trailers, footers, authors). --opt by=author, gap=<h>, all=1",
  defaultPath: ".",
  merit: "commits + log1p(lines_added + lines_removed)/2",
  metrics: [{ key: "commits", label: "Commits" }, { key: "lines_added", label: "Lines added" }, { key: "lines_removed", label: "Lines removed" }, { key: "files", label: "Files touched" }],
  async sessions(path, ctx) {
    const repos = findRepos(path);
    if (!repos.length) throw new Error(`no git repository at ${path} or in its sub-folders`);
    const extra = extraAgents(ctx.options.agent);
    const gapMs = Number(ctx.options.gap ?? 3) * 36e5;
    const out = [];
    for (const repo of repos) {
      let commits;
      try { commits = await log(repo, ctx); } catch (e) { ctx.log(`${repo}: ${e.message.split("\n")[0]}`); continue; }
      out.push(...commitsToSessions(commits, { repo: basename(repo), byAuthor: ctx.options.by === "author", extra, gapMs, track: ctx.track }));
    }
    ctx.log(`${repos.length} repositories read`);
    return out;
  },
};

const RS = "\x1e", US = "\x1f", GS = "\x1d";

async function log(repo, ctx) {
  const args = ["-C", repo, "log", "--no-merges", "--numstat", `--format=${RS}%H${US}%an${US}%ae${US}%cn${US}%aI${US}%B${GS}`];
  if (ctx.options.all) args.splice(3, 0, "--all");
  if (ctx.since !== undefined) args.push(`--since=${new Date(ctx.since).toISOString()}`);
  const { stdout } = await run("git", args, { maxBuffer: 1 << 30 });
  return parseLog(stdout);
}

/** Parse the output of the git log format above. */
export function parseLog(text) {
  return text.split(RS).filter((r) => r.trim()).map((r) => {
    const [head, numstat = ""] = r.split(GS);
    const [sha, author, email, committer, date, ...body] = head.split(US);
    let added = 0, removed = 0, files = 0;
    for (const line of numstat.split("\n")) {
      const m = /^(\d+|-)\t(\d+|-)\t/.exec(line);
      if (m) { files++; added += m[1] === "-" ? 0 : Number(m[1]); removed += m[2] === "-" ? 0 : Number(m[2]); }
    }
    return { sha, author, email, committer, date, body: body.join(US), added, removed, files };
  });
}

/** Commits to sessions: per agent and repository, split where the gap is longer than gapMs. */
export function commitsToSessions(commits, { repo = "", byAuthor = false, extra = [], gapMs = 3 * 36e5, track }) {
  const byAgent = new Map();
  for (const c of commits) {
    const name = byAuthor ? c.author : agentOf([c.author, c.email, c.committer, ...credits(c.body)], extra);
    if (!name) continue;
    if (!byAgent.has(name)) byAgent.set(name, []);
    byAgent.get(name).push(c);
  }
  const out = [];
  for (const [name, list] of byAgent) {
    list.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    let t = null, last = 0;
    const flush = () => { if (t) { if (repo) t.set("repo", repo); const s = t.session(); if (s) out.push(s); } };
    for (const c of list) {
      const ms = Date.parse(c.date);
      if (!t || ms - last > gapMs) { flush(); t = track({ name, idleMinutes: 60 }); }
      t.count("commits", 1, c.date).count("lines_added", c.added, c.date).count("lines_removed", c.removed, c.date).count("files", c.files, c.date);
      last = ms;
    }
    flush();
  }
  return out;
}

function findRepos(path) {
  const isRepo = (p) => existsSync(join(p, ".git"));
  if (isRepo(path)) return [path];
  const out = [];
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (e.startsWith(".") || e === "node_modules") continue;
      const p = join(dir, e);
      try { if (!statSync(p).isDirectory()) continue; } catch { continue; }
      if (isRepo(p)) out.push(p); else if (depth < 2) walk(p, depth + 1);
    }
  };
  walk(path, 1);
  return out.sort();
}
