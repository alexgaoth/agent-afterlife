import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";

// The voice pack (temple/voices) must say every line of temple/speech.js, in every voice, and each file it names
// must be there. A missing clip would leave a pilgrim silent; a stale one would say an old line.
const here = (p) => new URL(p, import.meta.url);
const pack = JSON.parse(readFileSync(here("../temple/voices/manifest.json"), "utf8"));
const src = readFileSync(here("../temple/speech.js"), "utf8");
const say = Object.fromEntries([...src.slice(src.indexOf("const SAY = {"), src.indexOf("};", src.indexOf("const SAY = {")))
  .matchAll(/^\s+(\w+): (\[.*\]),$/gm)].map(([, g, list]) => [g, JSON.parse(list)]));

test("every line in temple/speech.js has a clip in every voice, with the same text", () => {
  assert.ok(Object.keys(say).length >= 7, "found the lines in speech.js");
  for (const [group, lines] of Object.entries(say)) lines.forEach((text, i) => {
    const line = pack.lines[`${group}-${i}`];
    assert.ok(line, `${group}-${i} is in the pack`);
    assert.equal(line.text, text, `${group}-${i} says the current text`);
    assert.equal(line.named, text.startsWith("{n}，"), `${group}-${i}: named`);
    for (const v of pack.voices) {
      assert.ok(line.dur[v] > 0.5 && line.dur[v] < 6, `${group}-${i} ${v}: duration ${line.dur[v]}`);
      assert.ok(existsSync(here(`../temple/voices/lines/${v}/${group}-${i}.mp3`)), `${group}-${i} ${v}: file`);
    }
  });
  assert.equal(Object.keys(pack.lines).length, Object.values(say).flat().length, "no lines the code no longer has");
});

// A name whose take might be misread is left out of that voice (the pilgrim then says a line without a name).
test("every name has a clip in at least one voice, and every clip listed is there", () => {
  assert.ok(Object.keys(pack.names).length >= 280);
  assert.ok(pack.gap >= 0.05 && pack.gap <= 0.4);
  for (const [name, n] of Object.entries(pack.names)) {
    assert.ok(Object.keys(n.dur).length >= 1, `${name}: some voice says it`);
    assert.ok(Object.keys(n.dur).every((v) => pack.voices.includes(v)), `${name}: known voices`);
  }
  for (const [name, n] of Object.entries(pack.names)) for (const v of Object.keys(n.dur)) {
    assert.ok(n.dur[v] > 0.2 && n.dur[v] < 2, `${name} ${v}: duration ${n.dur[v]}`);
    const f = here(`../temple/voices/names/${v}/${n.file}.mp3`);
    assert.ok(existsSync(f) && statSync(f).size > 1000, `${name} ${v}: file`);
  }
});
