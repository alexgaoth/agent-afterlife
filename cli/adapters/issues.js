// Shared by the issue-tracker adapters: one agent life per issue, from a few plain fields.
//   { name, key, url, created, started, finished, state: "started" | "done" | "canceled" | "todo", points }
// An issue that never started has no life yet and is skipped.

export function issuesToSessions(issues, { track, only }) {
  const out = [];
  for (const i of issues) {
    if (!i.name || i.state === "todo" || (only && !only.test(i.name))) continue;
    const start = i.started || i.created;
    const end = i.finished || i.updated || start;
    const t = track({ name: i.name });
    t.at(start);
    if (i.state === "done") { t.count("issues", 1, end); if (typeof i.points === "number") t.count("points", i.points, end); }
    else if (i.state === "canceled") t.count("canceled", 1, end);
    else t.at(end);
    if (i.team) t.set("team", i.team);
    out.push(t.session({ alive: i.state === "started", ...(i.url ? { url: i.url } : {}) }));
  }
  return out.filter(Boolean);
}

export function onlyRegex(opt) { return opt ? new RegExp(opt, "i") : undefined; }
