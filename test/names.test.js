import { test } from "node:test";
import assert from "node:assert/strict";
import { SPOKEN, HOW, nameReport, listText } from "../cli/names.js";
import { BUILT_IN } from "../cli/adapters/index.js";

test("the names the pilgrims can say come from the voice pack, most famous first, with pinyin", () => {
  assert.ok(SPOKEN.length >= 280);
  assert.deepEqual(SPOKEN.slice(0, 2), [{ name: "岳飞", pinyin: "yuè fēi" }, { name: "关羽", pinyin: "guān yǔ" }]);
  assert.ok(SPOKEN.every((n) => n.pinyin && [...n.name].length === n.pinyin.split(" ").length));
  assert.equal(listText().split("\n").length, Math.ceil(SPOKEN.length / 4));
});

test("a report says which names can be spoken and suggests unused ones; it renames nothing", () => {
  const doc = { agents: [{ name: "岳飞" }, { name: "岳飞" }, { name: "Ada" }, { name: "Unnamed" }] };
  const r = nameReport(doc, { suggest: 3 });
  assert.deepEqual([r.names, r.spoken, r.silent], [["岳飞", "Ada"], ["岳飞"], ["Ada"]]);
  assert.deepEqual(r.next.map((n) => n.name), ["关羽", "诸葛亮", "韩信"]);
  assert.deepEqual(doc.agents.map((a) => a.name), ["岳飞", "岳飞", "Ada", "Unnamed"]);
});

test("every built-in source says how its agents get their names", () => {
  for (const a of BUILT_IN) assert.ok(HOW[a.name], `${a.name} has a note`);
});
