// copilot-agent: GitHub Copilot coding agent. Not a new data source: the `github` adapter kept to Copilot's pull requests.
//
// Source: the GitHub GraphQL API, through cli/adapters/github.js (same query, paging, retries, --since, --opt max=<n>).
// A pull request is Copilot's when its author is the bot "copilot-swe-agent" (REST/GraphQL login of the app, also "copilot-swe-agent[bot]")
// or "Copilot" (the login GraphQL shows for the same actor), or its branch starts with "copilot/" (the branch the agent creates, as
// "copilot/fix-123"). Every one of those is one life named "Copilot", alive while the PR is open, as with `github`.
// Path: owner/repo[,owner/repo]. Auth: GITHUB_TOKEN or GH_TOKEN, else the `gh` login.
// Merit: the github adapter's own formula (merged PRs weigh most, then commits and the size of the change).
//
// How sure: the author logins and branch prefix are what GitHub's docs and public Copilot PRs show. Nothing new is parsed, so the risk is
// only in the filter: a human PR on a branch named "copilot/..." is also counted. Medium-high.
import github, { githubSessions } from "./github.js";

const COPILOT = /^(copilot-swe-agent|copilot)(\[bot\])?$/i;
export const isCopilot = (pr) => COPILOT.test(pr?.author?.login || "") || /^copilot\//i.test(pr?.headRefName || "");

export default {
  name: "copilot-agent",
  description: "GitHub Copilot coding agent: the pull requests it opened (author copilot-swe-agent / Copilot, copilot/ branches); path: owner/repo[,owner/repo]. --opt max=<n>",
  remote: true,
  merit: github.merit,
  metrics: github.metrics,
  sessions: (path, ctx) => githubSessions(path, ctx, (pr) => (isCopilot(pr) ? "Copilot" : null)),
};
