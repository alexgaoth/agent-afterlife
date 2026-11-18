// An example adapter for a made-up agent runner that writes one JSON file per run:
//   { "agent": "Ada", "events": [{ "at": "2026-01-05T09:00:00Z", "type": "commit" }, ...] }
// Try it:  agent-afterlife import examples/my-adapter.js examples/runs
// Copy it, change the parsing, keep the shape.
import { readFile } from "node:fs/promises";

export default {
  name: "my-runner",
  description: "Run logs of my agent runner (one JSON file per run)",
  defaultPath: "~/.my-runner/runs",           // used when no path is given
  merit: "commits + prs_merged*5 + hours/4",  // the default merit; --merit overrides it
  async sessions(dir, { files, track }) {
    const sessions = [];
    for (const file of await files(dir, /\.json$/)) {
      const run = JSON.parse(await readFile(file, "utf8"));
      const s = track({ name: run.agent });     // one agent life per run
      for (const e of run.events) {
        if (e.type === "commit") s.count("commits", 1, e.at);
        else if (e.type === "pr_merged") s.count("prs_merged", 1, e.at);
        else s.at(e.at);                         // any other event is activity
      }
      sessions.push(s.session());                // null when the run has no events
    }
    return sessions;
  },
};
