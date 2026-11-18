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

test("init --ci gitlab and netlify write their host's file with the build command", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "aa-ci-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(cli("init", join(dir, "g"), "--ci", "gitlab").status, 0);
  const g = readFileSync(join(dir, "g", ".gitlab-ci.yml"), "utf8");
  assert.match(g, /^pages:/m);
  assert.match(g, /build git \. --out public/);
  assert.match(g, /- public/);
  assert.equal(cli("init", join(dir, "n"), "--ci", "netlify", "--source", "data/agents.csv").status, 0);
  const n = readFileSync(join(dir, "n", "netlify.toml"), "utf8");
  assert.match(n, /command = "npx -y github:alexgaoth\/agent-afterlife build data\/agents.csv --out site"/);
  assert.match(n, /publish = "site"/);
  assert.ok(existsSync(join(dir, "n", "data", "agents.csv")));
  for (const f of [g, n]) assert.doesNotMatch(f, /__\w+__/);
  assert.match(cli("init", join(dir, "x"), "--ci", "heroku").stderr, /--ci must be github, gitlab or netlify/);
});
