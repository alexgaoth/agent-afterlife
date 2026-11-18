import { test } from "node:test";
import assert from "node:assert/strict";
import linear from "../cli/adapters/linear.js";
import jira from "../cli/adapters/jira.js";
import { helpers } from "../cli/adapters/index.js";
import { toDoc } from "../cli/core.js";
import { validate } from "../shared/afterlife.js";

process.env.TZ = "UTC";

const node = (id, extra) => ({ identifier: id, url: `https://example.com/${id}`, createdAt: "2026-01-05T08:00:00Z", startedAt: "2026-01-05T09:00:00Z",
  completedAt: "2026-01-05T12:00:00Z", canceledAt: null, updatedAt: "2026-01-05T12:00:00Z", estimate: 3, state: { type: "completed" },
  team: { key: "ENG" }, assignee: { name: "ada", displayName: "Ada" }, delegate: null, ...extra });

test("linear: delegate first, then assignee; unstarted issues skipped; paging; a retry without the agent field", async () => {
  const pages = [
    { nodes: [node("ENG-1", { delegate: { name: "robo", displayName: "Robo" } }), node("ENG-2")], pageInfo: { hasNextPage: true, endCursor: "c1" } },
    { nodes: [node("ENG-3", { state: { type: "started" }, completedAt: null }), node("ENG-4", { state: { type: "unstarted" } }),
      node("ENG-5", { state: { type: "canceled" }, completedAt: null, canceledAt: "2026-01-06T10:00:00Z" })], pageInfo: { hasNextPage: false } },
  ];
  const seen = [];
  let failedOnce = false;
  const ctx = { ...helpers({}), graphql: async (q, v) => {
    if (!failedOnce) { failedOnce = true; throw new Error('Cannot query field "delegate" on type "Issue".'); }
    seen.push([v.cursor, q.includes("delegate")]);
    return { issues: pages[seen.length - 1] };
  } };
  const s = await linear.sessions("ENG", ctx);
  assert.deepEqual(seen, [[null, false], ["c1", false]]);
  assert.deepEqual(s.map((x) => [x.name, x.alive, x.stats.issues ?? 0, x.stats.points ?? 0, x.stats.canceled ?? 0]),
    [["Robo", false, 1, 3, 0], ["Ada", false, 1, 3, 0], ["Ada", true, 0, 0, 0], ["Ada", false, 0, 0, 1]]);
  const byAssignee = await linear.sessions("all", { ...helpers({ options: { by: "assignee", only: "^ad" } }), graphql: async () => ({ issues: { ...pages[0], pageInfo: { hasNextPage: false } } }) });
  assert.deepEqual(byAssignee.map((x) => x.name), ["Ada", "Ada"]);
  assert.deepEqual(validate(toDoc(s, { merit: linear.merit, now: "2026-01-07T00:00:00Z" })), []);
});

test("jira: JQL from a project key, done, canceled and in-progress issues", async () => {
  const urls = [];
  const issue = (key, cat, extra = {}) => ({ key, fields: { assignee: { displayName: "Robo" }, created: "2026-01-05T08:00:00.000+0000", updated: "2026-01-05T12:00:00.000+0000",
    resolutiondate: cat === "done" ? "2026-01-05T12:00:00.000+0000" : null, statuscategorychangedate: "2026-01-05T10:00:00.000+0000",
    status: { statusCategory: { key: cat } }, resolution: null, customfield_10016: 5, ...extra } });
  const pages = [
    { issues: [issue("ENG-1", "done"), issue("ENG-2", "indeterminate")], nextPageToken: "t1", isLast: false },
    { issues: [issue("ENG-3", "new"), issue("ENG-4", "done", { resolution: { name: "Won't Do" } })], isLast: true },
  ];
  const ctx = { ...helpers({ since: Date.parse("2026-01-01") }), jiraGet: async (u) => { urls.push(u); return pages[urls.length - 1]; } };
  const s = await jira.sessions("ENG", ctx);
  const jql = new URLSearchParams(urls[0].split("?")[1]).get("jql");
  assert.equal(jql, '(project = ENG) AND assignee is not EMPTY AND updated >= "2026-01-01"');
  assert.match(urls[1], /nextPageToken=t1/);
  assert.deepEqual(s.map((x) => [x.alive, x.stats.issues ?? 0, x.stats.points ?? 0, x.stats.canceled ?? 0]), [[false, 1, 5, 0], [true, 0, 0, 0], [false, 0, 0, 1]]);
  assert.deepEqual(validate(toDoc(s, { merit: jira.merit, now: "2026-01-07T00:00:00Z" })), []);
});
