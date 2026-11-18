# Adapters: bring any agent workflow

An adapter reads one tool's raw data (transcripts, run logs, a tracker's API, a spreadsheet) and returns
**sessions**: one per agent life. `agent-afterlife` turns sessions into a document that follows
[`schema/afterlife.schema.json`](schema/afterlife.schema.json), and the temple and the graveyard draw it.

```sh
agent-afterlife adapters                         # what is built in, and what this machine has
agent-afterlife import <source> [path]           # write afterlife.json
agent-afterlife serve <source> [path]            # import and look at it at once
```

## No code: a file of sessions, events or day rows

If your workflow can write a file, you need no adapter. `import` reads `.json` (an array), `.jsonl` and
`.csv`/`.tsv`, and accepts three kinds of record. Column names are not case-sensitive.

| Record | Needs | Example |
|---|---|---|
| A session | a name and a start | `name,start,end,commits,status` → `Ada,2026-01-05T09:00Z,2026-01-05T11:30Z,4,ended` |
| An event | a name and a time | `{"agent":"Ada","time":"2026-01-05T09:10:00Z","kind":"commit"}` |
| A day | a name and a date | `name,date,merged,hours` → `Ada,2026-01-05,2,3.5` |

- **Names**: `name`, `agent`, `agent_name`, `author` or `assignee`. Records with one name are one agent;
  add `session` (or `session_id`, `run`, `thread`) to split them into several lives with that name.
- **Times**: `start`/`started_at`/`created_at`, `end`/`ended_at`/`closed_at`, `time`/`timestamp`/`ts`,
  `date`/`day`. Any ISO date, or Unix seconds or milliseconds.
- **Numbers**: every other numeric column becomes a stat (`commits`, `prs_merged`, `cost_usd`, ...). An event's
  `kind` becomes a stat counted once per event (or `n` times, with an `n` column).
- **Status**: `alive` (true/false) or `status` (`running`, `active`, `open` = alive). Without it, an agent
  active in the last 30 minutes is alive (`--alive-within`).
- **Hours**: a column wins. Otherwise a session counts from start to end, and events count the gaps between
  them up to 15 minutes (a session left open overnight is not work).

So the smallest integration is one line in your agent's loop:

```sh
echo "{\"agent\":\"$AGENT\",\"time\":\"$(date -u +%FT%TZ)\",\"kind\":\"commit\"}" >> ~/agent-events.jsonl
```

and then `agent-afterlife serve ~/agent-events.jsonl --merit "commit"`. See [`examples/`](examples/).

## Merit

Merit is the one ranking value. It is a formula over each day's stats, summed over the agent's days:

```sh
agent-afterlife import claude-code --merit "prs_merged*5 + commits + hours/4"
```

Numbers, stat names, `+ - * / ( )`, and `min()`, `max()`, `sqrt()`, `log1p()`. A missing stat is 0. The
formula is parsed, never run as code. Without `--merit`, the adapter's own default is used; for files, a
`merit` column, else `hours`, else days worked. The formula is written into the document (`source.merit`).

From merit the importer also writes the small chart: each day's value is that day's merit as a percentile of
every agent-day in the fleet (0 to 100), and the score is the hours-weighted average of those values.

## Write an adapter

A module whose default export has a `name` and a `sessions(path, ctx)` function. This one is
[`examples/my-adapter.js`](examples/my-adapter.js), for a made-up runner that writes one JSON file per run:

```js
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
```

```sh
agent-afterlife import examples/my-adapter.js examples/runs --out - | head
agent-afterlife serve examples/my-adapter.js examples/runs
```

### What `ctx` gives you

| Helper | Does |
|---|---|
| `track({ name, idleMinutes = 15 })` | Collects one agent's activity. `.at(time)` marks activity, `.count(stat, n, time)` counts an event on that day, `.count(stat, n)` adds a total without a time (it goes on the last day), `.set(stat, "text")` sets a string stat, `.session(extra)` returns the session (or `null` if there was no activity). Hours are the gaps between activities up to `idleMinutes`. |
| `files(dir, regex)` | Every file under `dir` (recursive, no `node_modules` or `.git`) whose path matches, sorted. With `--since`, files not modified since then are skipped. |
| `lines(file, filter?)` | Async iterator over the parsed lines of a JSON Lines file. Bad lines are skipped. `filter` (a string or a list) skips lines that do not contain it before parsing, which is much faster on big transcripts. |
| `since` | `--since` as milliseconds, or `undefined`. |
| `log(message)` | Prints to stderr, prefixed with the adapter's name. |
| `home` | The user's home folder. |

### A session, if you build it yourself

```js
{
  name: "Ada",                                  // many sessions may share a name: they become generations
  start: "2026-01-05T09:00:00Z", end: "2026-01-05T11:30:00Z",   // ISO, Date, or Unix s/ms
  alive: false,                                 // optional; default: active within --alive-within minutes
  stats: { commits: 4, model: "some-model" },   // totals; numbers, or short strings
  days: { "2026-01-05": { commits: 4, hours: 2.5 } },  // optional; per day, for merit and the chart
  merit: 12.5,                                  // optional; skips the formula
  score: 71, url: "https://...", epitaph: "..." // optional, as in the schema
}
```

`days` decide merit (the formula runs on each day) and the chart. Without `days`, all stats go on the
`end` day. Dates are local calendar days; set `TZ` to change the time zone.

## Add a built-in adapter

1. `cli/adapters/<name>.js`, exported default as above, with a `defaultPath` where the tool keeps its logs.
2. Add it to `BUILT_IN` in `cli/adapters/index.js`.
3. A synthetic fixture under `test/fixtures/<name>/` (never real transcripts: they hold code and prompts) and a
   test in `test/adapters.test.js`.
4. `npm test`, then a pull request.
