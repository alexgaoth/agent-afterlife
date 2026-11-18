import { test } from "node:test";
import assert from "node:assert/strict";
import { embedUrl } from "../shared/embed.js";

test("embedUrl: setting, embed flag, data URL or demo, extra parameters", () => {
  const base = "https://example.com/afterlife/";
  assert.equal(embedUrl({ base }).href, "https://example.com/afterlife/temple/?embed=1&demo=");
  assert.equal(embedUrl({ base, setting: "graveyard", data: { schema: "agent-afterlife/1", agents: [] } }).href, "https://example.com/afterlife/graveyard/?embed=1");
  const u = embedUrl({ base, data: "https://data.example.com/fleet.json", params: { cam: "0,0,30,0,0" } });
  assert.equal(u.searchParams.get("data"), "https://data.example.com/fleet.json");
  assert.equal(u.searchParams.get("cam"), "0,0,30,0,0");
  assert.equal(embedUrl({ base, data: "fleet.json" }).searchParams.get("data"), "https://example.com/afterlife/fleet.json");
  assert.throws(() => embedUrl({ base, setting: "chapel" }), /setting/);
});
