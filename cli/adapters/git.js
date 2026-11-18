// git: commits made by AI agents in local repositories. Works with any agent workflow that commits.
//
// A commit is an agent's when its author, or a trailer or footer in its message, names a known agent:
// "Co-authored-by: Claude", "Generated with Claude Code", "Name (aider)", "copilot-swe-agent[bot]", ...
// An agent's commits in one repository form one session until a gap of more than --opt gap=<hours> (3).
//   --opt by=author          every author is an agent, named by the author's name
//   --opt agent=<regex>=<N>  also count commits matching regex as agent N (";" between several)
//   --opt lines=0            skip line counts (much faster on long histories; merit then counts commits)
//   --opt all=1              read every branch (git log --all), not only the checked-out one (automatic for a
//                            repository with several worktrees: each repository is read once)
// The path is a repository, or a folder whose sub-folders (two levels) are repositories. Default: ".".
import { execFile, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
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
    const byAuthor = ctx.options.by === "author";
    const gapMs = Number(ctx.options.gap ?? 3) * 36e5;
    // Worktrees and checkouts of one repository share its history: read each repository once (all its branches
    // when it has several checkouts), and count each commit once even if two clones hold it.
    const groups = new Map();
    for (const r of repos) {
      const common = commonDir(r);
      if (!groups.has(common)) groups.set(common, []);
      groups.get(common).push(r);
    }
    const lines = ctx.options.lines !== "0";
    const list = [...groups].map(([common, checkouts]) => ({ repo: checkouts[0], name: repoName(common, checkouts[0]), all: checkouts.length > 1 || !!ctx.options.all }));
    const fail = (g, e) => { ctx.log(`${g.repo}: ${String(e.stderr || e.message).trim().split("\n")[0]}`); g.commits = []; };
    // Read in parallel, but decide in a fixed order which repository a shared commit belongs to (the first),
    // so the result does not depend on which git finished first.
    await pool(list, async (g) => { try { g.commits = await log(g.repo, ctx, g); } catch (e) { fail(g, e); } });
    const seen = new Set();
    for (const g of list) g.commits = g.commits.filter((c) => !seen.has(c.sha) && seen.add(c.sha) && (byAuthor || agentOf([c.author, c.email, c.committer, ...credits(c.body)], extra)));
    if (lines) await pool(list.filter((g) => g.commits.length), async (g) => {
      try { const st = await shortstats(g.repo, g.commits.map((c) => c.sha)); for (const c of g.commits) Object.assign(c, st.get(c.sha) || {}); }
      catch (e) { ctx.log(`${g.repo}: line counts skipped: ${String(e.stderr || e.message).trim().split("\n")[0]}`); }
    });
    const out = list.flatMap((g) => commitsToSessions(g.commits, { repo: g.name, byAuthor, extra, gapMs, track: ctx.track }));
    ctx.log(`${repos.length} checkouts of ${groups.size} repositories read`);
    return out;
  },
};

/** Run fn over items, four at a time. */
async function pool(items, fn, n = 4) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { while (queue.length) await fn(queue.shift()); }));
}

/** The repository's shared git directory: <repo>/.git, or for a worktree the main repository's. */
export function commonDir(checkout) {
  const dotgit = join(checkout, ".git");
  try {
    if (statSync(dotgit).isDirectory()) return realpathSync(dotgit);
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotgit, "utf8"));
    if (!m) return realpathSync(dotgit);
    const gitdir = resolve(checkout, m[1].trim());
    const cd = join(gitdir, "commondir");
    return realpathSync(existsSync(cd) ? resolve(gitdir, readFileSync(cd, "utf8").trim()) : gitdir);
  } catch { return dotgit; }
}

function repoName(common, checkout) {
  return basename(common) === ".git" ? basename(dirname(common)) : basename(common).replace(/\.git$/, "") || basename(checkout);
}

const RS = "\x1e", US = "\x1f", GS = "\x1d";

// Commit metadata only: cheap even for long histories. Line counts come later, for agent commits only.
async function log(repo, ctx, { all = false } = {}) {
  const args = ["-C", repo, "log", "--no-merges", `--format=${RS}%H${US}%an${US}%ae${US}%cn${US}%aI${US}%B${GS}`];
  if (all) args.push("--all");
  if (ctx.since !== undefined) args.push(`--since=${new Date(ctx.since).toISOString()}`);
  const { stdout } = await run("git", args, { maxBuffer: 1 << 30 });
  return parseLog(stdout);
}

/** Files, lines added and removed for the given commits: one `git log --stdin --shortstat` run. */
function shortstats(repo, shas) {
  return new Promise((resolve, reject) => {
    const p = spawn("git", ["-C", repo, "log", "--no-walk=unsorted", "--stdin", "--shortstat", `--format=${RS}%H`], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.setEncoding("utf8").on("data", (d) => { out += d; });
    p.stderr.setEncoding("utf8").on("data", (d) => { err += d; });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code) return reject(Object.assign(new Error(`git log --stdin exited ${code}`), { stderr: err }));
      const m = new Map();
      for (const rec of out.split(RS)) {
        const [sha, ...rest] = rec.trim().split("\n");
        if (!sha) continue;
        const t = rest.join(" ");
        const n = (re) => Number((re.exec(t) || [0, 0])[1]);
        m.set(sha, { files: n(/(\d+) files? changed/), added: n(/(\d+) insertions?/), removed: n(/(\d+) deletions?/) });
      }
      resolve(m);
    });
    p.stdin.end(shas.join("\n") + "\n");
  });
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
