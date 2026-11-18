import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIN = new URL("../bin/agent-afterlife.js", import.meta.url).pathname;
const cli = (...a) => spawnSync(process.execPath, [BIN, ...a], { encoding: "utf8" });

test("init writes a Pages workflow, with example data for a file source, and never overwrites", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "aa-init-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(cli("init", dir).status, 0);
  const wf = readFileSync(join(dir, ".github/workflows/afterlife.yml"), "utf8");
  assert.match(wf, /uses: alexgaoth\/agent-afterlife@main/);
  assert.match(wf, /source: github\n/);
  assert.match(wf, /actions\/deploy-pages@v4/);
  assert.doesNotMatch(wf, /__\w+__/);
  assert.equal(cli("init", dir).status, 1);
  const dir2 = join(dir, "other");
  assert.equal(cli("init", dir2, "--source", "data/agents.csv").status, 0);
  assert.ok(existsSync(join(dir2, "data/agents.csv")));
  assert.match(readFileSync(join(dir2, ".github/workflows/afterlife.yml"), "utf8"), /source: data\/agents.csv/);
});
