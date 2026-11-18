// The adapter for examples/cron: one agent life per row of runs.csv, its day built from that run's own log.
//   agent-afterlife serve examples/cron/cron-adapter.js examples/cron
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export default {
  name: "cron-runs",
  description: "Nightly agent runs: runs.csv plus logs/<run id>/events.jsonl",
  merit: "prs_merged*5 + tests_passed + tool_calls/10",
  async sessions(dir, { track, lines, parseCsv }) {
    const runs = parseCsv(await readFile(join(dir, "runs.csv"), "utf8"));
    const out = [];
    for (const run of runs) {
      // Runs of one role become generations of one name; the whole run counts as work (no idle limit).
      const s = track({ name: run.agent, idleMinutes: 24 * 60 });
      s.at(run.start).at(run.end);
      const log = join(dir, "logs", run.run_id, "events.jsonl");
      if (existsSync(log)) for await (const e of lines(log)) {
        if (e.kind === "tool_call") s.count("tool_calls", 1, e.time);
        else if (e.kind === "pr_merged") s.count("prs_merged", 1, e.time);
        else if (e.kind === "test_run") s.count(e.passed ? "tests_passed" : "tests_failed", 1, e.time);
      }
      out.push(s.session({ epitaph: run.exit_code === 0 ? undefined : `Stopped with exit code ${run.exit_code}.` }));
    }
    return out;
  },
};
