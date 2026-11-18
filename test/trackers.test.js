import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import git, { parseLog, commitsToSessions } from "../cli/adapters/git.js";
import github, { prsToSessions } from "../cli/adapters/github.js";
import { agentOf, credits, extraAgents } from "../cli/adapters/agents.js";
import { helpers } from "../cli/adapters/index.js";
import { track, toDoc } from "../cli/core.js";
import { validate } from "../shared/afterlife.js";

process.env.TZ = "UTC";

test("agentOf: authors, trailers, footers, branches, and extra rules", () => {
  assert.equal(agentOf(["copilot-swe-agent[bot]"]), "Copilot");
  assert.equal(agentOf(["Ada Lovelace (aider)"]), "Aider");
  assert.equal(agentOf(credits("Fix\n\nCo-authored-by: Claude <noreply@anthropic.com>")), "Claude");
  assert.equal(agentOf(credits("Fix\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)")), "Claude");
  assert.equal(agentOf(["codex"]), "Codex");
  assert.equal(agentOf(credits("Fix the cursor position bug")), null);   // body text that is not a credit line
  assert.equal(agentOf(["ada"]), null);
  assert.equal(agentOf(["robo-7"], extraAgents("^robo-=Robo")), "Robo");
  assert.throws(() => extraAgents("no-name"), /regex/);
});

test("git: commits by agents become sessions split by gaps", () => {
  const c = (date, body, author = "Ada") => ({ sha: "x", author, email: "ada@example.com", committer: author, date, body, added: 10, removed: 2, files: 1 });
  const commits = [
    c("2026-01-05T09:00:00Z", "a\n\nCo-authored-by: Claude <noreply@anthropic.com>"),
    c("2026-01-05T09:40:00Z", "b\n\nCo-authored-by: Claude <noreply@anthropic.com>"),
    c("2026-01-05T18:00:00Z", "c\n\nCo-authored-by: Claude <noreply@anthropic.com>"),   // more than 3 h later: a new life
    c("2026-01-05T10:00:00Z", "d", "Ada (aider)"),
    c("2026-01-05T11:00:00Z", "plain human commit"),
  ];
  const s = commitsToSessions(commits, { repo: "demo", track });
  assert.deepEqual(s.map((x) => [x.name, x.stats.commits, x.stats.repo]), [["Claude", 2, "demo"], ["Claude", 1, "demo"], ["Aider", 1, "demo"]]);
  assert.equal(s[0].stats.hours, 0.67);
  assert.equal(commitsToSessions(commits, { byAuthor: true, track }).length, 3);
});

test("git: reads a real repository", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "aa-git-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.com", GIT_AUTHOR_DATE: "2026-01-05T09:00:00Z", GIT_COMMITTER_DATE: "2026-01-05T09:00:00Z" } });
  g("init", "-q");
  writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
  g("add", "a.txt");
  g("commit", "-q", "-m", "Add a\n\nCo-authored-by: Claude <noreply@anthropic.com>");
  writeFileSync(join(dir, "b.txt"), "x\n");
  g("add", "b.txt");
  g("commit", "-q", "-m", "Add b by hand");
  const [s, ...rest] = await git.sessions(dir, helpers({}));
  assert.equal(rest.length, 0);
  assert.deepEqual([s.name, s.stats.commits, s.stats.lines_added, s.stats.files], ["Claude", 1, 2, 1]);
  assert.deepEqual(parseLog(""), []);
});

test("github: PRs by agents, one life each, paged until --since", async () => {
  const pr = (n, extra) => ({ number: n, url: `https://example.com/pull/${n}`, state: "MERGED", createdAt: "2026-01-05T09:00:00Z", mergedAt: "2026-01-05T12:00:00Z",
    closedAt: "2026-01-05T12:00:00Z", headRefName: "feature", body: "", author: { login: "ada" }, additions: 100, deletions: 10, changedFiles: 3,
    commits: { totalCount: 2 }, reviews: { totalCount: 1 }, comments: { totalCount: 0 }, ...extra });
  const pages = [
    { nodes: [pr(4, { state: "OPEN", mergedAt: null, closedAt: null, updatedAt: "2026-01-07T00:00:00Z", createdAt: "2026-01-06T09:00:00Z", author: { login: "copilot-swe-agent" } }),
      pr(3, { headRefName: "claude/fix-login" })], pageInfo: { hasNextPage: true, endCursor: "c1" } },
    { nodes: [pr(2, { body: "x\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)" }), pr(1, { createdAt: "2025-12-01T00:00:00Z" })], pageInfo: { hasNextPage: true, endCursor: "c2" } },
  ];
  const calls = [];
  const ctx = { ...helpers({ since: Date.parse("2026-01-01") }), graphql: async (q, v) => { calls.push(v.cursor); return { repository: { pullRequests: pages[calls.length - 1] } }; } };
  const s = await github.sessions("acme/demo", ctx);
  assert.deepEqual(calls, [null, "c1"]);                      // stopped at the PR older than --since
  assert.deepEqual(s.map((x) => [x.name, x.alive, x.stats.prs_merged ?? 0]), [["Copilot", true, 0], ["Claude", false, 1], ["Claude", false, 1]]);
  assert.equal(s[1].url, "https://example.com/pull/3");
  const doc = toDoc(s, { merit: github.merit, now: "2026-01-07T00:10:00Z" });
  assert.deepEqual(validate(doc), []);
  assert.equal(prsToSessions([pr(9)], { byAuthor: true, track })[0].name, "ada");
  await assert.rejects(github.sessions("not-a-repo", ctx), /owner\/repo/);
});

test("github: a server error is tried again; a repository that keeps failing is skipped, not the import", async () => {
  const page = { nodes: [{ number: 1, url: "u", state: "MERGED", createdAt: "2026-01-05T09:00:00Z", mergedAt: "2026-01-05T10:00:00Z", headRefName: "claude/x",
    body: "", author: { login: "ada" }, additions: 1, deletions: 0, changedFiles: 1, commits: { totalCount: 1 }, reviews: { totalCount: 0 }, comments: { totalCount: 0 } }],
  pageInfo: { hasNextPage: false } };
  const calls = {}, logs = [];
  const ctx = { ...helpers({ log: (m) => logs.push(m) }), retryWaitMs: 1, graphql: async (q, v) => {
    calls[v.name] = (calls[v.name] || 0) + 1;
    if (v.name === "flaky" && calls.flaky < 3) throw new Error("gh: HTTP 502");
    if (v.name === "down") throw new Error("gh: HTTP 503");
    if (v.name === "gone") throw new Error("Could not resolve to a Repository");
    return { repository: { pullRequests: page } };
  } };
  const s = await github.sessions("acme/flaky,acme/down,acme/gone,acme/ok", ctx);
  assert.equal(s.length, 2);                                   // flaky (after two retries) and ok
  assert.deepEqual([calls.flaky, calls.down, calls.gone, calls.ok], [3, 4, 1, 1]);
  assert.ok(logs.some((m) => /2 of 4 repositories skipped/.test(m)));
  await assert.rejects(github.sessions("acme/down", ctx), /acme\/down: gh: HTTP 503/);
});

test("git: a repository and its worktrees are read once, with every branch, each commit once", async (t) => {
  const top = mkdtempSync(join(tmpdir(), "aa-wt-"));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const main = join(top, "repo"), wt = join(top, "repo-feature");
  const env = { ...process.env, GIT_AUTHOR_NAME: "Ada", GIT_AUTHOR_EMAIL: "ada@example.com", GIT_COMMITTER_NAME: "Ada", GIT_COMMITTER_EMAIL: "ada@example.com" };
  const g = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { env, stdio: "pipe" });
  execFileSync("git", ["init", "-q", main]);
  writeFileSync(join(main, "a.txt"), "1\n"); g(main, "add", "a.txt");
  g(main, "commit", "-q", "-m", "one\n\nCo-authored-by: Claude <noreply@anthropic.com>");
  g(main, "worktree", "add", "-q", "-b", "feature", wt);
  writeFileSync(join(wt, "b.txt"), "2\n"); g(wt, "add", "b.txt");
  g(wt, "commit", "-q", "-m", "two\n\nCo-authored-by: Claude <noreply@anthropic.com>");
  writeFileSync(join(wt, "c.txt"), "3\n"); g(wt, "add", "c.txt");
  g(wt, "commit", "-q", "-m", "a human commit that mentions claude in passing");
  const s = await git.sessions(top, helpers({}));
  assert.equal(s.reduce((n, x) => n + x.stats.commits, 0), 2);   // not 4 (two checkouts), not 3 (the mention)
  assert.ok(s.every((x) => x.stats.repo === "repo"));
});
