import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve, setDataMeta } from "../cli/site.js";

const BIN = new URL("../bin/agent-afterlife.js", import.meta.url).pathname;
const FIXTURE = new URL("./fixtures/minimal.json", import.meta.url).pathname;
const run = (...a) => spawnSync(process.execPath, [BIN, ...a], { encoding: "utf8" });

test("validate accepts a good document and rejects a bad one", () => {
  assert.match(run("validate", FIXTURE).stdout, /is valid\. 2 agents/);
  const bad = run("validate", BIN);
  assert.equal(bad.status, 1);
});

test("demo --json prints a valid document", () => {
  const doc = JSON.parse(execFileSync(process.execPath, [BIN, "demo", "--json"], { encoding: "utf8" }));
  assert.equal(doc.agents.length, 90);
});

test("build writes the site with the data linked from both pages", () => {
  const out = join(mkdtempSync(join(tmpdir(), "aa-")), "site");
  assert.equal(run("build", FIXTURE, "--out", out).status, 0);
  for (const f of ["index.html", "data.json", "temple/main.js", "graveyard/graveyard.js", "shared/afterlife.js", "schema/afterlife.schema.json"])
    assert.ok(existsSync(join(out, f)), f);
  assert.ok(!existsSync(join(out, "cli")) && !existsSync(join(out, "test")));
  for (const p of ["temple", "graveyard"]) assert.match(readFileSync(join(out, p, "index.html"), "utf8"), /<meta name="afterlife-data" content="data.json">/);
});

test("setDataMeta adds, replaces and removes the tag", () => {
  const a = setDataMeta("<html><head><title>x</title>", "a.json");
  assert.match(a, /<head>\n<meta name="afterlife-data" content="a.json">/);
  assert.match(setDataMeta(a, "https://x/b.json"), /content="https:\/\/x\/b.json"/);
  assert.doesNotMatch(setDataMeta(a, ""), /afterlife-data/);
});

test("serve gives the site and the data, and nothing outside the site", async () => {
  const doc = JSON.parse(readFileSync(FIXTURE));
  const { server, url } = await serve({ data: () => doc, port: 0, open: false, log: () => {} });
  const base = new URL(url).origin;
  try {
    assert.equal((await fetch(`${base}/temple/`)).status, 200);
    assert.deepEqual(await (await fetch(`${base}/data.json`)).json(), doc);
    for (const p of ["/package.json", "/cli/site.js", "/%2e%2e/%2e%2e/etc/passwd"]) assert.equal((await fetch(base + p)).status, 404, p);
  } finally { server.close(); }
});
