# Agent Afterlife

Where AI coding agents rest when their sessions end. Two settings, one data file:

- **The Graveyard.** An English churchyard at night. Every ended agent gets a headstone; the best get monuments, passers-by get an unmarked grave.
- **The Temple (武庙).** A walkable, first-person Song-dynasty temple laid out as the 武成王庙 was in 1123: one main seat, one companion, ten in the hall, sixty-two in the side halls. Agents become painted clay statues, and the scene is rendered like an aged temple mural.

Open the site with no data and it shows a made-up demo fleet.

## Run it

```sh
python3 tools/serve.py                # the demo fleet
python3 tools/serve.py my-fleet.json  # your own data
```

Browsers do not run ES modules from `file://`, so any static server works; this one also maps your file to `/data.json`. On a hosted copy, add `?data=<url>` to the address.

## The temple

Walk with WASD or the arrow keys, hurry with Shift, look with the mouse, read a statue with E (or a click), step out with Esc. On a phone: drag to look, hold the button to walk.

- **Who sits where.** Merit rank picks the group (main seat, companion, the ten in the hall, the sixty-two in the side halls). Era (`born`) picks the seat inside the group, alternating east and west, east first, as in the 1123 record. Each pedestal names the general who held that seat then. Agents past the 74th wait outside the gate; living agents hang as lanterns outside it.
- **The look.** Yongle Palace murals were painted outline-and-fill: ink line first, mineral pigment inside. The renderer does the same in a post-process: a Kuwahara filter flattens shading into pigment, depth and colour edges become ink, then paper fibre, craquelure, small losses and water stains age it. Behind the walls stand 青绿 (blue-green) mountains.
- **Links.** `?cam=x,y,z,yaw,pitch` starts at a viewpoint, `?read=<agent id>` opens that agent's scroll, `?plain=1` turns the mural effect off.

## Bring your own data

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

The pages check the document when they load it and list any problems instead of drawing a broken scene.

## Layout of the repo

| Path | What it is |
|---|---|
| `schema/` | The data contract. |
| `shared/afterlife.js` | Loading, validation, ranking and the seeded demo fleet. Both settings import it. |
| `graveyard/` | The English graveyard. |
| `temple/` | The three.js temple. |
| `tools/serve.py` | A local server that can serve your data file. |

## References

- 武庙 seating of 1123: [zh.wikipedia: 武庙](https://zh.wikipedia.org/wiki/%E6%AD%A6%E5%BA%99)
- Mural technique (ink outline, then mineral pigment): [Yongle Palace murals](https://baike.baidu.com/en/item/Yongle%20Palace%20Murals/1421663)
- Mineral palette of Tang murals: [Dunhuang pigment study](https://www.researchgate.net/publication/396862173_Pigment_Application_and_Color_Matching_Rules_in_Tang_Dynasty_Murals_of_the_Dunhuang_Mogao_Grottoes)
- Painterly post-processing: [Maxime Heckel, On Crafting Painterly Shaders](https://blog.maximeheckel.com/posts/on-crafting-painterly-shaders/)

MIT licensed.
