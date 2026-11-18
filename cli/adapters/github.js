// github: pull requests opened by AI agents, one agent life per pull request.
//
// A PR is an agent's when its author (copilot-swe-agent, devin-ai-integration[bot], ...), its branch
// (claude/..., codex/..., cursor/...) or a footer in its body ("Generated with Claude Code") names a known agent.
// The path is one or more repositories: "owner/repo" or "owner/a,owner/b".
//   --opt by=author          every PR author is an agent, named by login
//   --opt agent=<regex>=<N>  also count PRs matching regex as agent N
//   --opt max=<n>            read at most n PRs per repository (default 1000), newest first
// Auth: GITHUB_TOKEN or GH_TOKEN, else the `gh` command-line tool's login.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { agentOf, credits, extraAgents } from "./agents.js";

const run = promisify(execFile);
const QUERY = `query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 50, after: $cursor, orderBy: { field: CREATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { number url state createdAt mergedAt closedAt updatedAt headRefName body
        author { login } additions deletions changedFiles
        commits { totalCount } reviews { totalCount } comments { totalCount } }
    }
  }
}`;

export default {
  name: "github",
  description: "Pull requests by AI agents on GitHub; path: owner/repo[,owner/repo]. --opt by=author, max=<n>",
  remote: true,
  merit: "prs_merged*5 + commits/2 + log1p(lines_added + lines_removed)/2",
  metrics: [{ key: "prs_merged", label: "PRs merged" }, { key: "commits", label: "Commits" }, { key: "lines_added", label: "Lines added" },
    { key: "reviews", label: "Reviews" }, { key: "repo", label: "Repository" }],
  sessions: (path, ctx) => githubSessions(path, ctx),
};

/**
 * Read the pull requests of one or more repositories and turn them into sessions. `nameOf(pr)` (optional) decides which PRs are
 * an agent's and what the agent is called: a name, or null to leave the PR out. This is how the copilot-agent preset reuses it.
 */
export async function githubSessions(path, ctx, nameOf) {
  const graphql = ctx.graphql || ghGraphql;
  const extra = extraAgents(ctx.options.agent);
  const max = Number(ctx.options.max ?? 1000);
  const out = [], failed = [];
  const repos = String(path).split(/[,\s]+/).filter(Boolean);
  for (const full of repos) if (full.split("/").filter(Boolean).length !== 2) throw new Error(`"${full}" is not owner/repo`);
  const results = new Array(repos.length);
  const queue = repos.map((full, i) => [full, i]);
  const one = async ([full, i]) => {
    const [owner, name] = full.split("/");
    try {
      const prs = [];
      let cursor = null;
      do {
        const data = await retry(() => graphql(QUERY, { owner, name, cursor }), { ...ctx, log: (m) => ctx.log(`${full}: ${m}`) });
        const page = data?.repository?.pullRequests;
        if (!page) throw new Error("no such repository, or no access");
        let old = false;
        for (const pr of page.nodes) {
          if (ctx.since !== undefined && Date.parse(pr.createdAt) < ctx.since) { old = true; break; }
          prs.push(pr);
        }
        cursor = !old && page.pageInfo.hasNextPage && prs.length < max ? page.pageInfo.endCursor : null;
      } while (cursor);
      const s = prsToSessions(prs, { repo: name, byAuthor: ctx.options.by === "author", extra, track: ctx.track, nameOf });
      ctx.log(`${full}: ${prs.length} PRs read, ${s.length} by agents`);
      results[i] = s;
    } catch (e) {
      // One repository that fails does not lose the others.
      if (repos.length === 1) throw new Error(`${full}: ${e.message}`);
      failed.push(full);
      ctx.log(`${full}: skipped: ${e.message}`);
    }
  };
  // Four repositories at a time; the result keeps the order they were given in.
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => { while (queue.length) await one(queue.shift()); }));
  for (const r of results) if (r) out.push(...r);
  if (failed.length === repos.length) throw new Error(`every repository failed (${failed.join(", ")})`);
  if (failed.length) ctx.log(`${failed.length} of ${repos.length} repositories skipped: ${failed.join(", ")}`);
  return out;
}

/** Try again after a server error, a timeout or a rate limit: 3 more times, waiting 1, 4 and 9 s (ctx.retryWaitMs to change). */
export async function retry(fn, ctx = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); }
    catch (e) {
      const transient = /HTTP 5\d\d|HTTP 429|rate limit|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|timed? ?out/i.test(e.message);
      if (!transient || attempt >= 3) throw e;
      const wait = (ctx.retryWaitMs ?? 1000) * (attempt + 1) ** 2;
      ctx.log?.(`${e.message.split("\n")[0]}; trying again in ${Math.round(wait / 1000)} s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/** Pull requests (GraphQL nodes) to sessions. */
export function prsToSessions(prs, { repo = "", byAuthor = false, extra = [], track, nameOf }) {
  const out = [];
  for (const pr of prs) {
    const login = pr.author?.login || "ghost";
    const name = nameOf ? nameOf(pr) : byAuthor ? login : agentOf([login, pr.headRefName?.split("/")[0], ...credits(pr.body)], extra);
    if (!name) continue;
    const end = pr.mergedAt || pr.closedAt || pr.updatedAt || pr.createdAt;
    const t = track({ name });
    t.count("prs_opened", 1, pr.createdAt);
    if (pr.mergedAt) t.count("prs_merged", 1, pr.mergedAt);
    t.count("commits", pr.commits?.totalCount || 0, end).count("lines_added", pr.additions || 0, end)
      .count("lines_removed", pr.deletions || 0, end).count("files", pr.changedFiles || 0, end)
      .count("reviews", pr.reviews?.totalCount || 0, end).count("comments", pr.comments?.totalCount || 0, end);
    if (repo) t.set("repo", repo);
    out.push(t.session({ alive: pr.state === "OPEN", url: pr.url }));
  }
  return out;
}

async function ghGraphql(query, vars) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) {
    const res = await fetch(process.env.GITHUB_GRAPHQL_URL || "https://api.github.com/graphql", {
      method: "POST", headers: { authorization: `bearer ${token}`, "content-type": "application/json", "user-agent": "agent-afterlife" },
      body: JSON.stringify({ query, variables: vars }),
    });
    const body = await res.json();
    if (!res.ok || body.errors) throw new Error(body.errors?.[0]?.message || `GitHub: HTTP ${res.status}`);
    return body.data;
  }
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars)) if (v !== null && v !== undefined) args.push("-F", `${k}=${v}`);
  let stdout;
  try { ({ stdout } = await run("gh", args, { maxBuffer: 1 << 28 })); }
  catch (e) { throw new Error(e.code === "ENOENT" ? "set GITHUB_TOKEN, or install and log in to the gh command-line tool" : (e.stderr || e.message).trim().split("\n")[0]); }
  return JSON.parse(stdout).data;
}
