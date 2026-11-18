#!/usr/bin/env node
// agent-afterlife: show your own AI agents in the temple and the graveyard.
// Run with no arguments for help. No dependencies; Node 20 or newer.
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, relative, isAbsolute, extname } from "node:path";
import { validate, demo, ranked, living, passersBy } from "../shared/afterlife.js";
import { serve, build, PAGES, ROOT } from "../cli/site.js";
import { toDoc, anonymise } from "../cli/core.js";
import { BUILT_IN, loadAdapter, runAdapter, expandHome } from "../cli/adapters/index.js";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).version;
const HELP = `agent-afterlife ${VERSION}: a walkable temple and a graveyard for your AI agents.

Usage:
  agent-afterlife demo [--json]                   serve the made-up demo fleet (--json: print it instead)
  agent-afterlife import <source> [path]          read your agents' logs into afterlife.json (or --out)
  agent-afterlife serve <source|file|url>         serve the site with your data
  agent-afterlife build <source|file|url> --out <dir>   write a static site for any host
  agent-afterlife validate <file|url>             check a document against the schema
  agent-afterlife adapters                        list the built-in sources and which ones this machine has

A <source> is a built-in adapter (${BUILT_IN.map((a) => a.name).join(", ")}), several joined
with commas, your own adapter module (./my-adapter.js), or a .json/.jsonl/.csv file of sessions, events
or day rows. A file that already follows the schema is used as it is.

Import options (import, serve, build):
  --merit <formula>        how merit is computed from each day's stats, e.g. "commits + hours/4"
  --since <date|Nd>        only agents active since then, e.g. 2026-01-01 or 30d
  --title <text>           the fleet's name on the pages
  --min-merit <n>          below this merit an agent is a passer-by (default 0.1)
  --alive-within <min>     an agent active this recently counts as alive (default 30)
  --anonymize              replace names with made-up ones, drop urls and epitaphs (for publishing)

Site options:
  --page temple|graveyard|home   which page to open (default: temple)
  --port <n>                     port for serve and demo (default: 8123; 0 picks a free one)
  --no-open                      do not open a browser
  --snapshot                     build: copy a URL's data into the site instead of linking it

The data format: schema/afterlife.schema.json. Adapters: ADAPTERS.md (https://github.com/alexgaoth/agent-afterlife).`;

const { values: opt, positionals: [cmd, ...args] } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", short: "o" }, page: { type: "string", default: "temple" }, port: { type: "string", default: "8123" },
    "no-open": { type: "boolean" }, snapshot: { type: "boolean" }, json: { type: "boolean" },
    merit: { type: "string" }, since: { type: "string" }, title: { type: "string" }, "min-merit": { type: "string" },
    "alive-within": { type: "string" }, anonymize: { type: "boolean" }, anonymise: { type: "boolean" },
    help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" },
  },
});

const isUrl = (s) => /^https?:\/\//.test(s);
async function readDoc(src) {
  if (isUrl(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
    return res.json();
  }
  return JSON.parse(readFileSync(resolve(expandHome(src)), "utf8"));
}

/** Read and check a document; print the problems and stop if it is not valid. */
async function checked(src) {
  let doc;
  try { doc = await readDoc(src); } catch (e) { fail(`Could not read ${src}: ${e.message}`); }
  const problems = validate(doc);
  if (problems.length) fail(`${src} does not follow the schema:\n  - ${problems.join("\n  - ")}`);
  return doc;
}

/** Is src a finished document (a URL, or a .json file with "schema")? Otherwise it is a source to import. */
function isDocument(src) {
  if (isUrl(src)) return true;
  const f = expandHome(src);
  if (extname(f).toLowerCase() !== ".json" || !existsSync(f)) return false;
  try { const d = JSON.parse(readFileSync(f, "utf8")); return !Array.isArray(d) && d && "schema" in d; } catch { return false; }
}

function since(v) {
  if (!v) return undefined;
  const m = /^(\d+)d$/.exec(v);
  const ms = m ? Date.now() - Number(m[1]) * 864e5 : Date.parse(v);
  if (Number.isNaN(ms)) fail(`--since must be a date (2026-01-01) or a number of days (30d), not "${v}"`);
  return ms;
}

/** Run one or more sources and build a document. */
async function importDoc(spec, path) {
  const specs = spec.split(",").map((x) => x.trim()).filter(Boolean);
  if (specs.length > 1 && path) fail("Give a path only with a single source; several sources each read their default place.");
  const sessions = [], names = [];
  let merit = opt.merit, metrics;
  for (const sp of specs) {
    let adapter;
    try { adapter = await loadAdapter(sp); } catch (e) { fail(e.message); }
    let got;
    try { got = await runAdapter(adapter, path, { since: since(opt.since), log: (m) => console.error(`${adapter.name}: ${m}`) }); }
    catch (e) { fail(`${adapter.name}: ${e.message}`); }
    console.error(`${adapter.name}: ${got.length} sessions`);
    if (specs.length > 1) for (const s of got) s.stats = { ...s.stats, tool: adapter.name };
    sessions.push(...got); names.push(adapter.name);
    merit ??= adapter.merit && specs.length === 1 ? adapter.merit : undefined;
    metrics ??= specs.length === 1 ? adapter.metrics : undefined;
  }
  merit ??= autoMerit(sessions);
  const minMerit = opt["min-merit"] !== undefined ? Number(opt["min-merit"]) : undefined;
  let doc;
  try {
    doc = toDoc(opt.anonymize || opt.anonymise ? anonymise(sessions) : sessions, {
      title: opt.title, merit, minMerit, metrics, adapter: names.join(", "), tool: `agent-afterlife ${VERSION}`,
      aliveWithinMinutes: opt["alive-within"] !== undefined ? Number(opt["alive-within"]) : undefined,
    });
  } catch (e) { fail(e.message); }
  const problems = validate(doc);
  if (problems.length) fail(`The import made a document that does not follow the schema (a bug; please report it):\n  - ${problems.join("\n  - ")}`);
  return doc;
}

/** Without a formula: a merit column if there is one, else hours, else days worked. */
function autoMerit(sessions) {
  const has = (k) => sessions.some((s) => typeof s.stats?.[k] === "number");
  return has("merit") ? "merit" : has("hours") ? "hours" : "1";
}

/** A document from whatever the user gave: a URL or document file (checked), or a source (imported). */
async function obtain(src, path) {
  return isDocument(src) ? checked(src) : importDoc(src, path);
}

function summary(doc) {
  const d = { options: { minMerit: doc.options?.minMerit ?? 0.1 }, ...doc };
  return `${doc.agents.length} agents: ${ranked(d).length} ranked, ${passersBy(d).length} passers-by, ${living(d).length} alive`;
}

function fail(msg) { console.error(msg); process.exit(1); }
function need(arg, what) { if (!arg) fail(`${what}\n\n${HELP}`); return arg; }

async function main() {
  if (opt.version) return console.log(VERSION);
  if (opt.help || !cmd) return console.log(HELP);
  if (opt.page && !(opt.page in PAGES)) fail(`--page must be one of: ${Object.keys(PAGES).join(", ")}`);
  const port = Number(opt.port), open = !opt["no-open"];
  switch (cmd) {
    case "demo":
      if (opt.json) return console.log(JSON.stringify(demo(), null, 1));
      return serve({ data: null, port, page: opt.page, open });
    case "validate": {
      const src = need(args[0], "validate needs a file or a URL.");
      return console.log(`${src} is valid. ${summary(await checked(src))}.`);
    }
    case "import": {
      const doc = await importDoc(need(args[0], "import needs a source, e.g. claude-code or my-events.csv."), args[1]);
      const out = opt.out || "afterlife.json";
      if (out === "-") return console.log(JSON.stringify(doc, null, 1));
      writeFileSync(out, JSON.stringify(doc, null, 1));
      return console.log(`Wrote ${out}: ${summary(doc)}. Merit = ${doc.source.merit}.\nSee it: agent-afterlife serve ${out}`);
    }
    case "adapters": {
      for (const a of BUILT_IN) {
        const where = a.defaultPath ? expandHome(a.defaultPath) : null;
        const state = !where ? "give a file" : existsSync(where) ? `found ${a.defaultPath}` : `not found (${a.defaultPath})`;
        console.log(`  ${a.name.padEnd(12)} ${a.description}\n  ${"".padEnd(12)} ${state}`);
      }
      return console.log("\nYour own: agent-afterlife import ./my-adapter.js [path]   (see ADAPTERS.md)");
    }
    case "serve": {
      const src = need(args[0], "serve needs a source, a file or a URL (or run: agent-afterlife demo).");
      const doc = await obtain(src, args[1]);
      console.log(summary(doc));
      // A document file is re-read on every reload; an import or a URL is read once.
      const data = isDocument(src) && !isUrl(src)
        ? async () => { const d = await readDoc(src); const p = validate(d); if (p.length) throw new Error(p.join(" ")); return d; }
        : () => doc;
      return serve({ data, port, page: opt.page, open });
    }
    case "build": {
      const src = args[0];
      const out = resolve(need(opt.out, "build needs --out <dir>."));
      const up = relative(out, ROOT);
      if (!up || (!up.startsWith("..") && !isAbsolute(up))) fail("--out must not be the package folder or a folder above it.");
      const doc = src && (!isUrl(src) || opt.snapshot) ? await obtain(src, args[1]) : undefined;
      if (src && isUrl(src) && !opt.snapshot) await checked(src);
      build({ out, doc, url: doc ? undefined : src });
      return console.log(`Wrote the site to ${out}${src ? ` with ${doc ? "a copy of the data from " : "a link to "}${src}` : " (demo data)"}. Serve that folder with any static host.`);
    }
    default:
      fail(`Unknown command "${cmd}".\n\n${HELP}`);
  }
}

main().catch((e) => fail(e.stack || String(e)));
