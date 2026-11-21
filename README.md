# Agent Afterlife

Where AI coding agents rest when their sessions end. Point it at your agents' logs, commits, pull requests or issues, and walk among them.

![Walking up the lantern avenue of the temple, past the side halls of statues](https://raw.githubusercontent.com/alexgaoth/agent-afterlife/main/docs/temple-walk.gif)

- **The Temple (武庙).** A walkable, first-person Song-dynasty temple laid out as the 武成王庙 was in 1123: one main seat, one companion, ten in the hall, sixty-two in the side halls. The best agents become painted clay statues; the scene is rendered like an aged temple mural, and steles carry statistics about your fleet.
- **The Graveyard.** An English churchyard at night. Every ended agent gets a headstone; the best get monuments, passers-by an unmarked grave.

Live, with a made-up demo fleet: **[intro.alexgaoth.com/agent-afterlife](https://intro.alexgaoth.com/agent-afterlife/)**.

## Your agents in five minutes

You need Node 18 or newer (22 or 24 recommended). Nothing to install, nothing to configure: `npx` fetches it from npm (or install it with `npm i -g agent-afterlife`). The newest unreleased code: `npx github:alexgaoth/agent-afterlife`.

**1. Look at the demo.**

```sh
npx agent-afterlife demo
```

**2. Point it at your agents.** Pick what you have:

| You use | Run |
|---|---|
| Claude Code | `npx agent-afterlife serve claude-code` |
| Codex CLI, Gemini CLI, Factory Droid, Cursor, OpenHands, Cline, Continue | `... serve codex` (or `gemini`, `droid`, `cursor`, `openhands`, `cline`, `continue`; join several with commas) |
| OpenAI Agents SDK, LangSmith, Langfuse (exported traces) | `... serve openai-agents traces.jsonl` (or `langsmith runs.json`, `langfuse traces.json`) |
| aider | `... serve aider ~/code` |
| Any agent that commits (trailers like `Co-authored-by: Claude`) | `... serve git ~/code` |
| Agents that open pull requests (Copilot, Codex, Devin, Jules, ...) | `... serve github owner/repo` (Copilot's coding agent alone: `... serve copilot-agent owner/repo`) |
| Agents that close issues | `... serve linear ENG` or `... serve jira ENG` |
| Your own runner or workflow | append one JSON line per event, then `... serve events.jsonl` |
| Something else | a [30-line adapter](ADAPTERS.md#write-an-adapter): `... serve ./my-adapter.js` |

The one-line integration, from any script or agent loop:

```sh
echo "{\"agent\":\"$AGENT\",\"time\":\"$(date -u +%FT%TZ)\",\"kind\":\"commit\"}" >> ~/agent-events.jsonl
```

**3. Decide what counts.** Merit ranks the agents. It is a formula over each day's stats that you can change:

```sh
npx agent-afterlife serve claude-code --merit "prs_merged*5 + commits + hours/4"
```

**4. Publish it.** A static folder for any host, or your own GitHub Pages site that rebuilds every day:

```sh
npx agent-afterlife build claude-code --out site --anonymize   # made-up names, for publishing
npx agent-afterlife init                                       # a Pages workflow for this repo
```

Everything about sources, file formats, merit and writing adapters: **[ADAPTERS.md](ADAPTERS.md)**. A worked example, from a cron job's CSV to a 28-line adapter: [docs/walkthrough-cron.md](docs/walkthrough-cron.md).

## Your own site on GitHub Pages

In any repository, one command adds a workflow that builds the temple and the graveyard every day and publishes them on GitHub Pages:

```sh
npx agent-afterlife init                          # source: this repo's PRs by agents
npx agent-afterlife init --source data/agents.csv  # or your own file (an example is written)
```

Then commit, push, and set Settings > Pages > Source to "GitHub Actions". Or write the workflow yourself: the action takes the same sources and options as the command.

GitLab Pages, Netlify, Cloudflare Pages or your own server: `init --ci gitlab`, `init --ci netlify`, and recipes for the rest in **[docs/hosting.md](docs/hosting.md)**.

Or start from a copy of this repository: **Use this template** on GitHub (or fork it), then run `init` in your copy. Without a workflow, Pages from the `main` branch serves the demo fleet, and `?data=<url>` shows any document.

```yaml
- uses: alexgaoth/agent-afterlife@main
  with:
    source: github            # or git, a data file, a document, or ./my-adapter.js
    merit: "prs_merged*5 + commits"
    anonymize: true
- uses: actions/upload-pages-artifact@v3
  with: { path: _site }
```

## How big a fleet

Tested with 10,000 agents (`agent-afterlife demo --agents 10000`, a made-up fleet of any size):

| | 10,000 agents | 90 agents |
|---|---|---|
| Import 10,000 session rows (CSV) / 200,000 events (JSONL) | 0.2 s / 0.6 s | |
| Temple: first frame, GPU / no GPU | 1.1 s / 4.2 s | 1.7 s / 3.8 s |
| Temple: frames per second, GPU / no GPU (`low`, the default there) | 60 / 15 | 60 / 14 |
| Graveyard: all 8,588 headstones drawn | 0.7 s | 0.5 s |

The temple seats 74 and computes its statistics in milliseconds, so its cost does not grow with the fleet. The graveyard lays out only the headstones on screen.

## Commands

```text
agent-afterlife demo [--json]                    the demo fleet (--json prints its document: a template for yours)
agent-afterlife serve <source> [path]            import and show your agents (a document file is re-read on reload)
agent-afterlife import <source> [path]           write afterlife.json
agent-afterlife build <source> [path] --out dir  a static site; a URL source is linked, so the site shows its newest data
agent-afterlife validate <file|url>              check a document against the schema
agent-afterlife adapters                         the built-in sources, and which ones this machine has
agent-afterlife init [dir] [--source <s>]        a GitHub Pages workflow for your own site
```

Options: `--merit`, `--since 30d`, `--title`, `--min-merit`, `--alive-within`, `--anonymize`, `--opt key=value` (adapter options), `--page temple|graveyard|home`, `--port`, `--no-open`. From a clone, `node bin/agent-afterlife.js` does the same. On a hosted copy, `?data=<url>` shows any document and `?demo` the demo.

## Embed it

Show the temple or the graveyard inside your own dashboard. The view is an iframe; your data goes to it by `postMessage` and is not uploaded anywhere.

```html
<div id="afterlife" style="height: 70vh"></div>
<script type="module">
  import { mount } from "https://intro.alexgaoth.com/agent-afterlife/shared/embed.js";
  const view = mount(document.getElementById("afterlife"), {
    setting: "temple",                        // or "graveyard"
    data: myDocument,                         // a document, a URL to one, or nothing for the demo
    onSelect: (id) => console.log("opened", id),
  });
  view.open("Marlow #3");                     // open an agent from your page
</script>
```

Or a plain iframe: `<iframe src="https://<your site>/temple/?embed=1&data=<url>"></iframe>`. With `?embed=1` a page hides its links back to this site, and it sends messages to its parent: `agent-afterlife:loaded` (data checked), `agent-afterlife:shown` (first frame drawn, with timings: hide your spinner), `agent-afterlife:steady` (milliseconds per frame) and `agent-afterlife:select` (an agent opened). A full example: [`examples/embed.html`](examples/embed.html). `embed.js` from your own `build` or Pages site works the same way.

## Without a mouse, or without sight

- **Text version** (`text/`): the same document as plain HTML, the first link on every page. The eight findings as headings and paragraphs, the enshrined in a table (rank, name, seat, merit, dates, record), who is still working, and the passers-by. Works with screen readers and in browsers without WebGL.
- **Keyboard in the temple:** arrow keys walk and turn, <kbd>[</kbd> and <kbd>]</kbd> go from statue to statue by rank (the name is announced), <kbd>E</kbd> or <kbd>Enter</kbd> reads it, <kbd>Y</kbd> opens the annals, <kbd>Esc</kbd> steps out. Where the browser refuses pointer lock, keyboard mode starts by itself; `?keys=1` asks for it.
- **The graveyard:** every headstone is a button with its name, dates and record as its label; the tablet that opens is a dialog that returns focus when closed.

## The temple

Walk with WASD or the arrow keys, hurry with Shift, look with the mouse, read a statue with E (or a click), step out with Esc. On a phone: drag to look, hold the button to walk.

- **Who sits where.** Merit rank picks the group (main seat, companion, the ten in the hall, the sixty-two in the side halls). Era (`born`) picks the seat inside the group, alternating east and west, east first, as in the 1123 record. Each pedestal names the general who held that seat then. Agents past the 74th wait outside the gate. Living agents walk the courtyard as pilgrims (香客) in plain lay clothes, now and then pausing; look at one to read its name. They take a seat when their session ends.
- **The look.** Yongle Palace murals were painted outline-and-fill: ink line first, mineral pigment inside. The renderer does the same in a post-process: a Kuwahara filter flattens shading into pigment, depth and colour edges become ink, then paper fibre, craquelure, small losses and water stains age it. Behind the walls stand 青绿 (blue-green) mountains.
- **What the numbers say.** Eight steles (碑林) along the path each carry one statistic about the fleet, carved with its chart: how unevenly merit is shared (功德), how long agents last (生卒; agents still working count as far as they have got), output day by day (年表), whether a longer life pays (寿), whether reused names do better (世系), how scores spread (品), whether agents started later do better per day (进退) and which weekdays carry the work (七曜). Look at one and press E, or press Y anywhere, for the annals (年鉴) scroll with every chart and finding. The statistics come from `shared/insights.js`, use only schema fields, cover agents that did real work, and say how many agents each rests on.
- **Records (匾额).** Plaques hang under the eaves of the main hall: the temple's name over the middle bay, and one record over each bay beside it, from the middle out: longest life (寿考第一), best single day (一日之功), most hours (夙夜匪懈), most of the fleet's first metric (战功第一), best score (技冠群伦), most generations of one name (世泽绵长). Look at one for who holds it, since when, and who held it before; the annals list every holder. A record is set when a life ends.
- **The ancestral hall (祠堂).** Through a doorway in the west wall, north of the west side hall, lies a side court with the hall of lineages, 世德祠. Every name carried by more than one agent gets a panel of tablets (牌位), one per generation, oldest first; the longest lineages hang on the back wall. Look at a tablet for that agent; E opens its scroll.
- **Walking through time.** Stone lanterns (石灯笼) line the path, one per work day: the oldest at the gate, the newest at the hall steps. A lantern burns as bright as the fleet's merit that day; look at one for its date, merit and how many agents worked and ended. All lanterns are instanced: one draw call per part.
- **Reading a statue.** Gilded all over (金身): the top 10% of working agents by merit. Incense in the tripod censer (鼎): one stick per day served. Height: up to 8% taller or shorter within its group, by merit rank. A general (armour, helmet, a halberd 戟 or, for a red-faced general, the crescent glaive 偃月刀) shipped more per hour of work than the median enshrined agent (PRs merged, commits, issues closed); a strategist (scholar's cap, robe, a feather fan 羽扇, as 诸葛亮 is shown) worked more by planning and reviewing. Robe colour follows the agent's tool or model when the data has one. Face and beard only tell agents apart. Each statue is merged into a few draw calls per material.
- **Links.** `?cam=x,y,z,yaw,pitch` starts at a viewpoint, `?read=<agent id>` opens that agent's scroll, `?annals[=key]` opens the annals, `?plain=1` turns the mural effect off, `?quality=low` draws fewer pixels and no shadows (the default when the browser has no GPU; `?quality=high` forces full quality), `?still=1` draws a few frames and freezes (for screenshots).

## The data format

Both settings render only from a JSON document that follows [`schema/afterlife.schema.json`](schema/afterlife.schema.json). Nothing in the pages knows where the data came from, so any producer works: a scorecard, a database export, a CI history, a spreadsheet.

```json
{
  "schema": "agent-afterlife/1",
  "title": "My fleet",
  "metrics": [{ "key": "merged", "label": "PRs merged" }],
  "agents": [
    {
      "id": "Marlow #1", "name": "Marlow", "status": "ended",
      "born": "2026-01-05", "ended": "2026-01-08",
      "merit": 12.4, "score": 71,
      "stats": { "merged": 9 },
      "series": [{ "date": "2026-01-05", "value": 68, "weight": 3.5 }]
    },
    { "id": "Wren #2", "name": "Wren", "status": "alive", "born": "2026-01-09", "merit": 1.2 }
  ]
}
```

| Field | Meaning |
|---|---|
| `merit` | The one ranking value. Higher ranks higher. You decide how to compute it. |
| `status` | `ended` agents are buried or enshrined; `alive` ones wait outside. |
| `born`, `ended` | First and last day of work. The temple seats by era, so `born` matters. |
| `options.minMerit` | Below this (default 0.1), an agent is a passer-by: unmarked, never enshrined. |
| `metrics` | Which `stats` to show, in which order, with which labels. |
| `edicts` | Optional history of ranking changes. The temple carves the newest on its stele. |
| `source` | Optional: which tool and importer made the document, and how merit was computed. |

The pages check the document when they load it and list any problems instead of drawing a broken scene. `agent-afterlife validate` runs the same check (`shared/afterlife.js`, every rule of the schema) from the command line or in CI.

## Layout of the repo

| Path | What it is |
|---|---|
| `schema/` | The data contract. |
| `shared/afterlife.js` | Loading, validation, ranking and the seeded demo fleet. Both settings and the CLI import it. |
| `shared/embed.js` | `mount()`: the temple or the graveyard in someone else's page. |
| `bin/`, `cli/` | The `agent-afterlife` command: `demo`, `import`, `serve`, `build`, `validate`, `adapters`. No dependencies. |
| `cli/adapters/` | The importers (adapters) and the helpers they share. |
| `examples/` | An example adapter and example files of sessions and events. |
| `test/` | `npm test` (Node's built-in runner). |
| `action.yml` | The GitHub Action (`uses: alexgaoth/agent-afterlife@main`); `cli/templates/` holds the workflow `init` writes. |
| `graveyard/` | The English graveyard. |
| `temple/` | The three.js temple. |
| `tools/serve.py` | A local server that can serve your data file. |

## References

- 武庙 seating of 1123: [zh.wikipedia: 武庙](https://zh.wikipedia.org/wiki/%E6%AD%A6%E5%BA%99)
- Mural technique (ink outline, then mineral pigment): [Yongle Palace murals](https://baike.baidu.com/en/item/Yongle%20Palace%20Murals/1421663)
- Mineral palette of Tang murals: [Dunhuang pigment study](https://www.researchgate.net/publication/396862173_Pigment_Application_and_Color_Matching_Rules_in_Tang_Dynasty_Murals_of_the_Dunhuang_Mogao_Grottoes)
- Painterly post-processing: [Maxime Heckel, On Crafting Painterly Shaders](https://blog.maximeheckel.com/posts/on-crafting-painterly-shaders/)

MIT licensed.
