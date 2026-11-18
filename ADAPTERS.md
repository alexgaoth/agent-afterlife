# Adapters: bring any agent workflow

An adapter reads one tool's raw data (transcripts, run logs, a tracker's API, a spreadsheet) and returns
**sessions**: one per agent life. `agent-afterlife` turns sessions into a document that follows
[`schema/afterlife.schema.json`](schema/afterlife.schema.json), and the temple and the graveyard draw it.

```sh
agent-afterlife adapters                         # what is built in, and what this machine has
agent-afterlife import <source> [path]           # write afterlife.json
agent-afterlife serve <source> [path]            # import and look at it at once
```

## Built in

| Source | Reads | Notes |
|---|---|---|
| `claude-code` | `~/.claude/projects/*/*.jsonl` | One transcript = one agent. Name: the session's name (`claude -n`, `/rename`), else the project folder. Counts prompts, tool calls, file edits, shell commands, commits, PRs opened and merged (failed commands do not count), test runs, cost; subagents count as their parent's work. `--opt names=project` or `names=session`. |
| `codex` | `~/.codex/sessions` (`.jsonl` and `.jsonl.zst`) | OpenAI Codex CLI. Prompts, tool calls, commands, edits (patches), commits/PRs/tests, tokens, model. |
| `gemini` | `~/.gemini/tmp/<project>/` | Gemini CLI chat recordings (`chats/session-*.jsonl`, older `.json`) and checkpoints. |
| `droid` | `~/.factory/sessions` | Factory Droid. Prompts, tool calls, commands, edits, commits/PRs/tests, tokens and model from `<id>.settings.json`. |
| `aider` | `.aider.chat.history.md` under a folder (default `.`) | One life per `# aider chat started at`. Prompts, applied edits, commits, commands, cost. No per-message times, so hours are near 0. |
| `cursor` | Cursor's `state.vscdb` | Composer (chat and agent) sessions. Needs the `sqlite3` tool; reads only times, counts and tool names. |
| `openhands` | `~/.openhands` | OpenHands conversations: new (`events/event-*.json`, `base_state.json`) and old (`events/<n>.json`, `metadata.json`) stores. |
| `cline` | Cline's `globalStorage/saoudrizwan.claude-dev` (VS Code; macOS, Linux, Windows) or `~/.cline/data` | One task folder (`tasks/<id>/ui_messages.json`) = one life. Name: the task's workspace folder. Prompts, tool calls, edits, commands, commits/PRs/tests, tokens, cost, model. |
| `continue` | `~/.continue/sessions` | Continue session JSON. Name: the workspace folder. Prompts, tool calls, edits, commands, commits/PRs/tests, tokens, cost. The files have no message times: a session runs from its creation to its last save. |
| `openai-agents` | a JSON/JSONL file or folder of exported Agents SDK `trace` and `trace.span` records | One life per trace; name: the workflow name. Function spans are tool calls (edits, commands, commits by tool name), handoffs, generations, tokens, model. |
| `langsmith` | a JSON/JSONL file or folder of LangSmith runs (`list_runs`) | One life per trace; name: the root run's name (`--opt names=tag`: its first tag). Tool runs, llm runs, tokens, cost, model. |
| `langfuse` | a JSON/JSONL file or folder of Langfuse public API traces and observations | One life per trace; name: the trace name (`--opt names=tag`: first tag), else its agent observation. TOOL and GENERATION observations, tokens, cost, model. |
| `git` | local repositories (a repo, or a folder of repos) | Commits whose author or trailer names an agent (`Co-authored-by: Claude`, `Generated with ...`, `Name (aider)`, `copilot-swe-agent[bot]`, ...). One agent's commits in one repo are one life until a gap of 3 hours. Works with any workflow that commits. Worktrees and clones of one repository count each commit once. `--opt by=author`, `gap=<hours>`, `all=1`, `lines=0` (no line counts: faster), `agent=<regex>=<Name>`. |
| `github` | `owner/repo[,owner/repo]` | Pull requests whose author, branch (`claude/...`, `codex/...`) or body footer names an agent; one life per PR, alive while open. `GITHUB_TOKEN` or the `gh` login. `--opt by=author`, `max=<n>`, `agent=<regex>=<Name>`. |
| `copilot-agent` | `owner/repo[,owner/repo]` | GitHub's Copilot coding agent: the `github` adapter kept to pull requests by `copilot-swe-agent` / `Copilot` or on `copilot/` branches, every life named "Copilot". Same auth and options as `github` (`max=<n>`). |
| `linear` | team keys (`ENG,OPS`) or `all` | One life per started issue, named by the agent it is delegated to, else its assignee; alive while in progress. `LINEAR_API_KEY`. `--opt by=assignee`, `only=<regex>`. A Linear CSV export also works with `csv`. |
| `jira` | a project key or JQL | One life per started issue, named by its assignee. `JIRA_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`. `--opt only=<regex>`, `points=<field id>`. |
| `json`, `jsonl`, `csv` | a file you give | Sessions, events or day rows; below. |

Every harness adapter names an agent by its **project folder**, so one project's sessions become the
generations of one lineage, and no session title (often written from a prompt) is shown. `--opt names=title`
uses the tool's session titles instead. Claude Code also uses names you gave on purpose (`claude -n`, `/rename`).
`codex`, `gemini`, `aider`, `cursor`, `openhands`, `cline`, `continue`, `openai-agents`, `langsmith` and `langfuse` were written from the tools' formats and public source;
if your version logs differently, please open an issue with the line types (not the content).
`gemini`, `aider`, `cursor`, `openhands`, `cline`, `continue`, `openai-agents`, `langsmith` and `langfuse` say so when they meet files in a format they do not know (for example
`gemini: 3 files in an unknown format (version 7), skipped`); if every file is unknown the import stops with that message.
Each adapter's header comment lists the formats it reads and the source they come from.

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
The same from Python or JavaScript:

```python
import json, datetime
def log_event(agent, kind, n=1, path="agent-events.jsonl"):
    with open(path, "a") as f:
        f.write(json.dumps({"agent": agent, "time": datetime.datetime.now(datetime.timezone.utc).isoformat(), "kind": kind, "n": n}) + "\n")
```

```js
import { appendFileSync } from "node:fs";
const logEvent = (agent, kind, n = 1) =>
  appendFileSync("agent-events.jsonl", JSON.stringify({ agent, time: new Date().toISOString(), kind, n }) + "\n");
```

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

A longer example, from a cron job's CSV to an adapter and a nightly site: [docs/walkthrough-cron.md](docs/walkthrough-cron.md).

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
| `files(dir, regex, { maxDepth })` | Every file under `dir` (recursive, no `node_modules` or `.git`) whose path matches, sorted. With `--since`, files not modified since then are skipped. |
| `lines(file, filter?)` | Async iterator over the parsed lines of a JSON Lines file. Bad lines are skipped. `filter` (a string or a list) skips lines that do not contain it before parsing, which is much faster on big transcripts. |
| `shellEvents(command)` | What a shell command did: `{ commits, prs_opened, prs_merged, tests }`. It reads each simple command, so a commit message or `git log --grep commit` does not count. For adapters that read agent transcripts. |
| `parseCsv(text)` | Rows of a CSV or TSV text with a header row, as objects; numbers and true/false typed. |
| `options` | The `--opt key=value` pairs, as an object. Document the ones your adapter reads in its `description`. |
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

1. `cli/adapters/<name>.js`, exported default as above, with a `defaultPath` where the tool keeps its logs
   (or `remote: true` when the argument is not a local path, as for `github`). To know which agent made a
   commit or a PR, use `agentOf()` and `credits()` from `cli/adapters/agents.js`.
2. Add it to `BUILT_IN` in `cli/adapters/index.js`.
3. A synthetic fixture under `test/fixtures/<name>/` (never real transcripts: they hold code and prompts) and a
   test in `test/adapters.test.js`.
4. `npm test`, then a pull request.

## Before you publish

Transcripts and logs name your projects, branches and sometimes clients. The importers never copy prompt or
message text into the document, but names, project folders and URLs do appear. For a public site use
`--anonymize` (stable made-up names such as "Quiet Heron", no URLs or epitaphs), `--opt names=project` where it
helps, and look at the document (`import ... --out afterlife.json`) before you deploy it.
