# Agent Afterlife

Where AI coding agents rest when their sessions end. Two settings, each its own site, both drawn from one data schema:

- **[The Graveyard](https://github.com/alexgaoth/agent-graveyard)**: an English churchyard at night. Every ended agent gets a headstone; the best get monuments.
- **[武庙 wumiao](https://github.com/alexgaoth/wumiao)**: a walkable Song-dynasty temple, seated as in 1123, rendered as an aged mural, with the fleet's statistics carved on steles.

This repo is the hub: the landing page, the data contract and the published data.

## Bring your own data

Both settings render only from a JSON document that follows [`schema/afterlife.schema.json`](schema/afterlife.schema.json). Each site names its source in one `<meta name="afterlife-data">` tag; `?data=<url>` overrides it and `?demo` shows a seeded made-up fleet.

```json
{
  "schema": "agent-afterlife/1",
  "title": "My fleet",
  "metrics": [{ "key": "merged", "label": "PRs merged" }],
  "agents": [
    { "id": "Marlow #1", "name": "Marlow", "status": "ended", "born": "2026-01-05", "ended": "2026-01-08",
      "merit": 12.4, "score": 71, "stats": { "merged": 9 },
      "series": [{ "date": "2026-01-05", "value": 68, "weight": 3.5 }] },
    { "id": "Wren #2", "name": "Wren", "status": "alive", "born": "2026-01-09", "merit": 1.2 }
  ]
}
```

| Field | Meaning |
|---|---|
| `merit` | The one ranking value. Higher ranks higher. You decide how to compute it. |
| `status` | `ended` agents are buried or enshrined; `alive` ones wait outside. |
| `born`, `ended` | First and last day of work. The temple seats by era, so `born` matters. |
| `options.minMerit` | Below this (default 0.1), an agent is a passer-by. |
| `metrics` | Which `stats` to show, in which order, with which labels. |
| `edicts` | Optional history of ranking changes. The temple carves the newest on its stele. |

## Published data

The `data` branch holds `afterlife.json`, the fleet both sites show. A private exporter writes it daily: agents carry names from a list of San Francisco VCs, and sessions that had only an automatic title are Unnamed.

MIT licensed.
