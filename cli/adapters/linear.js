// linear: Linear issues, one agent life per issue, named by the agent it is delegated to (Linear's agent
// field), else its assignee. The path is one or more team keys ("ENG" or "ENG,OPS"), or "all".
//   --opt by=assignee        name by assignee even when there is a delegate
//   --opt only=<regex>       keep only names that match (for example your agents' names)
// Auth: LINEAR_API_KEY (a personal API key). Without a key, export a CSV from Linear and use the csv adapter.
import { issuesToSessions, onlyRegex } from "./issues.js";

export default {
  name: "linear",
  description: "Linear issues by the agent they are delegated or assigned to; path: team keys or all. LINEAR_API_KEY. --opt by=assignee, only=<re>",
  remote: true,
  merit: "issues*3 + points",
  metrics: [{ key: "issues", label: "Issues closed" }, { key: "points", label: "Points" }, { key: "canceled", label: "Canceled" }, { key: "team", label: "Team" }],
  async sessions(path, ctx) {
    const graphql = ctx.graphql || linearGraphql;
    const teams = String(path).toLowerCase() === "all" ? null : String(path).split(/[,\s]+/).filter(Boolean);
    const filter = { ...(teams ? { team: { key: { in: teams } } } : {}), ...(ctx.since !== undefined ? { updatedAt: { gte: new Date(ctx.since).toISOString() } } : {}) };
    const max = Number(ctx.options.max ?? 5000);
    let withDelegate = true, cursor = null;
    const nodes = [];
    for (;;) {
      let data;
      try { data = await graphql(query(withDelegate), { cursor, filter }); }
      catch (e) {
        if (withDelegate && /delegate/i.test(e.message)) { withDelegate = false; continue; }   // an API without the agent field
        throw e;
      }
      nodes.push(...data.issues.nodes);
      if (!data.issues.pageInfo.hasNextPage || nodes.length >= max) break;
      cursor = data.issues.pageInfo.endCursor;
    }
    const byAssignee = ctx.options.by === "assignee";
    const issues = nodes.map((n) => {
      const who = (!byAssignee && n.delegate) || n.assignee;
      return {
        name: who ? who.displayName || who.name : null, key: n.identifier, url: n.url, team: n.team?.key,
        created: n.createdAt, started: n.startedAt, updated: n.updatedAt, finished: n.completedAt || n.canceledAt,
        state: { completed: "done", canceled: "canceled", started: "started" }[n.state?.type] || "todo", points: n.estimate ?? undefined,
      };
    });
    ctx.log(`${nodes.length} issues read`);
    return issuesToSessions(issues, { track: ctx.track, only: onlyRegex(ctx.options.only) });
  },
};

const query = (delegate) => `query($cursor: String, $filter: IssueFilter) {
  issues(first: 100, after: $cursor, filter: $filter, orderBy: updatedAt) {
    pageInfo { hasNextPage endCursor }
    nodes { identifier url createdAt startedAt completedAt canceledAt updatedAt estimate
      state { type } team { key } assignee { name displayName } ${delegate ? "delegate { name displayName }" : ""} }
  }
}`;

async function linearGraphql(q, variables) {
  const key = process.env.LINEAR_API_KEY;
  if (!key) throw new Error("set LINEAR_API_KEY (Linear: Settings > Security & access > Personal API keys), or export a CSV and use the csv adapter");
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST", headers: { authorization: key, "content-type": "application/json" }, body: JSON.stringify({ query: q, variables }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors) throw new Error(body.errors?.[0]?.message || `Linear: HTTP ${res.status}`);
  return body.data;
}
