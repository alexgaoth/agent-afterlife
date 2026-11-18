import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate, demo } from "../shared/afterlife.js";

const example = JSON.parse(readFileSync(new URL("./fixtures/minimal.json", import.meta.url)));

test("the demo fleet and the minimal example are valid", () => {
  assert.deepEqual(validate(demo()), []);
  assert.deepEqual(validate(example), []);
});

test("each rule of the schema gives a readable problem", () => {
  const bad = (patch, expect) => {
    const doc = structuredClone(example);
    patch(doc);
    const p = validate(doc);
    assert.ok(p.some((x) => x.includes(expect)), `expected "${expect}" in ${JSON.stringify(p)}`);
  };
  bad((d) => { d.schema = "agent-afterlife/2"; }, '"schema" must be');
  bad((d) => { d.extra = 1; }, 'unknown field "extra"');
  bad((d) => { delete d.agents[0].merit; }, 'has no "merit"');
  bad((d) => { d.agents[1].id = d.agents[0].id; }, "id is used twice");
  bad((d) => { delete d.agents[0].ended; }, 'needs "ended"');
  bad((d) => { d.agents[0].ended = "2025-12-31"; }, "ended is before born");
  bad((d) => { d.agents[0].score = 101; }, "score must be");
  bad((d) => { d.agents[0].series[0].value = -1; }, "value must be");
  bad((d) => { d.agents[0].stats.merged = [1]; }, "must be a number or a string");
  bad((d) => { d.metrics[0] = { key: "merged" }; }, 'needs a string "label"');
  bad((d) => { d.edicts = [{ date: "2026-01-09T08:00:00Z", items: [{ kind: "crowned" }] }]; }, "kind must be one of");
  bad((d) => { d.source = { adapter: 3 }; }, "adapter must be a string");
  bad((d) => { d.generated = "yesterday"; }, '"generated" must be a date-time');
});

test("a long list of problems is cut short", () => {
  const doc = { schema: "agent-afterlife/1", agents: Array.from({ length: 50 }, () => ({})) };
  const p = validate(doc);
  assert.equal(p.length, 41);
  assert.match(p.at(-1), /more problems/);
});
