// jira: Jira issues, one agent life per issue, named by its assignee. The path is a project key ("ENG") or
// any JQL ("project = ENG AND labels = agent").
//   --opt only=<regex>       keep only assignees whose name matches (for example your agents' names)
//   --opt points=<field id>  the story-points field (default customfield_10016)
// Auth: JIRA_URL (https://you.atlassian.net), JIRA_EMAIL and JIRA_API_TOKEN. Or export a CSV and use csv.
import { issuesToSessions, onlyRegex } from "./issues.js";

export default {
  name: "jira",
  description: "Jira issues by assignee; path: a project key or JQL. JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN. --opt only=<re>, points=<field>",
  remote: true,
  merit: "issues*3 + points",
  metrics: [{ key: "issues", label: "Issues closed" }, { key: "points", label: "Points" }, { key: "canceled", label: "Canceled" }],
  async sessions(path, ctx) {
    const get = ctx.jiraGet || jiraGet;
    const pointsField = ctx.options.points || "customfield_10016";
    let jql = /^[A-Z][A-Z0-9_]+$/.test(path) ? `project = ${path}` : String(path);
    jql = `(${jql}) AND assignee is not EMPTY`;
    if (ctx.since !== undefined) jql += ` AND updated >= "${new Date(ctx.since).toISOString().slice(0, 10)}"`;
    const max = Number(ctx.options.max ?? 5000);
    const raw = [];
    let token;
    do {
      const q = new URLSearchParams({ jql, maxResults: "100", fields: `assignee,created,updated,resolutiondate,statuscategorychangedate,status,resolution,${pointsField}` });
      if (token) q.set("nextPageToken", token);
      const page = await get(`/rest/api/3/search/jql?${q}`);
      raw.push(...(page.issues || []));
      token = !page.isLast && page.nextPageToken && raw.length < max ? page.nextPageToken : undefined;
    } while (token);
    const base = (process.env.JIRA_URL || "").replace(/\/$/, "");
    const issues = raw.map((i) => {
      const f = i.fields || {}, cat = f.status?.statusCategory?.key;
      const canceled = cat === "done" && /won.?t|cancel|duplicate|reject/i.test(f.resolution?.name || "");
      return {
        name: f.assignee?.displayName, key: i.key, url: base ? `${base}/browse/${i.key}` : undefined,
        created: f.created, started: cat === "indeterminate" ? f.statuscategorychangedate : undefined, updated: f.updated,
        finished: cat === "done" ? f.resolutiondate || f.statuscategorychangedate : undefined,
        state: cat === "done" ? (canceled ? "canceled" : "done") : cat === "indeterminate" ? "started" : "todo",
        points: typeof f[pointsField] === "number" ? f[pointsField] : undefined,
      };
    });
    ctx.log(`${raw.length} issues read`);
    return issuesToSessions(issues, { track: ctx.track, only: onlyRegex(ctx.options.only) });
  },
};

async function jiraGet(path) {
  const { JIRA_URL: url, JIRA_EMAIL: email, JIRA_API_TOKEN: token } = process.env;
  if (!url || !email || !token) throw new Error("set JIRA_URL, JIRA_EMAIL and JIRA_API_TOKEN, or export a CSV and use the csv adapter");
  const res = await fetch(url.replace(/\/$/, "") + path, {
    headers: { authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`, accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.errorMessages?.[0] || `Jira: HTTP ${res.status}`);
  return body;
}
