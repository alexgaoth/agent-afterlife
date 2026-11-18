#!/usr/bin/env node
// agent-afterlife: show your own AI agents in the temple and the graveyard.
// Run with no arguments for help. No dependencies; Node 20 or newer.
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { validate, demo, ranked, living, passersBy } from "../shared/afterlife.js";
import { serve, build, PAGES, ROOT } from "../cli/site.js";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).version;
const HELP = `agent-afterlife ${VERSION}: a walkable temple and a graveyard for your AI agents.

Usage:
  agent-afterlife demo [--json]                 serve the made-up demo fleet (--json: print it instead)
  agent-afterlife serve <file|url>              serve the site with your data (re-read on each reload)
  agent-afterlife build <file|url> --out <dir>  write a static site for any host (GitHub Pages, S3, ...)
  agent-afterlife validate <file|url>           check a document against the schema

Options:
  --page temple|graveyard|home   which page to open (default: temple)
  --port <n>                     port for serve and demo (default: 8123; 0 picks a free one)
  --no-open                      do not open a browser
  --snapshot                     build: copy a URL's data into the site instead of linking it

The data format: schema/afterlife.schema.json (https://github.com/alexgaoth/agent-afterlife).`;

const { values: opt, positionals: [cmd, ...args] } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", short: "o" }, page: { type: "string", default: "temple" }, port: { type: "string", default: "8123" },
    "no-open": { type: "boolean" }, snapshot: { type: "boolean" }, json: { type: "boolean" },
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
  return JSON.parse(readFileSync(resolve(src), "utf8"));
}

/** Read and check a document; print the problems and stop if it is not valid. */
async function checked(src) {
  let doc;
  try { doc = await readDoc(src); } catch (e) { fail(`Could not read ${src}: ${e.message}`); }
  const problems = validate(doc);
  if (problems.length) fail(`${src} does not follow the schema:\n  - ${problems.join("\n  - ")}`);
  return doc;
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
    case "serve": {
      const src = need(args[0], "serve needs a file or a URL (or run: agent-afterlife demo).");
      const doc = await checked(src);
      console.log(summary(doc));
      const data = isUrl(src) ? () => doc : async () => { const d = await readDoc(src); const p = validate(d); if (p.length) throw new Error(p.join(" ")); return d; };
      return serve({ data, port, page: opt.page, open });
    }
    case "build": {
      const src = args[0];
      const out = resolve(need(opt.out, "build needs --out <dir>."));
      const up = relative(out, ROOT);
      if (!up || (!up.startsWith("..") && !isAbsolute(up))) fail("--out must not be the package folder or a folder above it.");
      const doc = src && (!isUrl(src) || opt.snapshot) ? await checked(src) : undefined;
      if (src && isUrl(src) && !opt.snapshot) await checked(src);
      build({ out, doc, url: doc ? undefined : src });
      return console.log(`Wrote the site to ${out}${src ? ` with ${doc ? "a copy of " : "a link to "}${src}` : " (demo data)"}. Serve that folder with any static host.`);
    }
    default:
      fail(`Unknown command "${cmd}".\n\n${HELP}`);
  }
}

main().catch((e) => fail(e.stack || String(e)));
