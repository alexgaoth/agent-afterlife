# Walkthrough: your own workflow, from a CSV to an adapter

A team runs an agent every night from cron. Each run triages new issues or writes release notes, and leaves a
log. This page takes that workflow to the temple in two steps: first with no code, then with a 28-line adapter.
All files are in [`examples/cron/`](../examples/cron/).

## The workflow

[`run-agent.sh`](../examples/cron/run-agent.sh) wraps one run. It times the agent command, then appends one
row to `runs.csv`; the agent itself writes one JSON line per event to `logs/<run id>/events.jsonl`.

```sh
# crontab: every night at 02:00
0 2 * * *  AGENT_CMD="my-agent triage" /srv/agents/run-agent.sh triage
```

```csv
run_id,agent,start,end,exit_code,prs_merged
r-0105,triage,2026-01-05T02:00:04Z,2026-01-05T02:41:30Z,0,2
r-0106,triage,2026-01-06T02:00:03Z,2026-01-06T02:12:55Z,1,0
r-0107,release-notes,2026-01-07T02:00:05Z,2026-01-07T03:05:12Z,0,1
```

## Step 1: no code

The CSV already has what the importer needs: a name (`agent`), a start and an end. Every other number becomes a
stat. Say what counts, and look:

```sh
npx agent-afterlife serve examples/cron/runs.csv --merit "prs_merged*5"
```

Each row is one agent life. Rows with one `agent` value are generations of one name: `triage #1`, `triage #2`.
Hours are each run's span. Merit is 5 per merged PR, so the failed run is a passer-by.

## Step 2: an adapter, when the CSV is not enough

The logs know more: tool calls, and tests that passed or failed. An adapter reads both. This is
[`cron-adapter.js`](../examples/cron/cron-adapter.js) in full:

```js
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
```

- `parseCsv` and `lines` read the files; `track` turns timestamped events into a session with per-day stats.
- `count(stat, n, time)` puts an event on its day, so merit and the small chart follow the days.
- The adapter's `merit` is the default; `--merit` still overrides it.
- An epitaph replaces the one the pages would write. Here, a failed run says so on its headstone.

Check what it makes before you look at it:

```sh
npx agent-afterlife import examples/cron/cron-adapter.js examples/cron --out -   # the document
npx agent-afterlife serve examples/cron/cron-adapter.js examples/cron              # the temple
```

## Step 3: publish every night

The cron machine can build the static site after each run and serve it with any web server:

```sh
30 2 * * *  npx -y agent-afterlife build /srv/agents/cron-adapter.js /srv/agents --out /var/www/afterlife
```

Or keep the adapter and the data in a repository and let GitHub Pages do it, with the action:

```yaml
- uses: alexgaoth/agent-afterlife@main
  with:
    source: ./afterlife/cron-adapter.js
    path: data/agents
```

Before a public site, read [Before you publish](../ADAPTERS.md#before-you-publish): `--anonymize` replaces names.
