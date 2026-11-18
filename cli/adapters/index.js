// The adapter registry, and the helpers every adapter gets.
//
// An adapter is a plain object (see ADAPTERS.md):
//   { name, description, defaultPath?, merit?, metrics?, sessions(path, ctx) }
// sessions() returns an array (or async iterable) of sessions; cli/core.js turns them into a document.
import { createReadStream, existsSync, statSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, extname, dirname, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { track, toMs } from "../core.js";
import { json, jsonl, csv, parseCsv } from "./generic.js";
import { shellEvents } from "./shell.js";
import claudeCode from "./claude-code.js";
import codex from "./codex.js";
import gemini from "./gemini.js";
import droid from "./droid.js";
import aider from "./aider.js";
import cursor from "./cursor.js";
import openhands from "./openhands.js";
import git from "./git.js";
import github from "./github.js";
import linear from "./linear.js";
import jira from "./jira.js";

// Agent harnesses first, then work trackers, then plain files.
export const BUILT_IN = [claudeCode, codex, gemini, droid, aider, cursor, openhands, git, github, linear, jira, json, jsonl, csv];
const BY_EXT = { ".json": json, ".jsonl": jsonl, ".ndjson": jsonl, ".csv": csv, ".tsv": csv };

/** An adapter by name, by file extension of the data, or from a module path ("./my-adapter.js"). */
export async function loadAdapter(spec) {
  const found = BUILT_IN.find((a) => a.name === spec);
  if (found) return found;
  if (/\.(m?js|cjs)$/.test(spec)) {
    const mod = await importModule(resolve(expandHome(spec)));
    const a = mod.default || mod.adapter;
    if (!a || typeof a.sessions !== "function") throw new Error(`${spec} must export default { name, sessions(path, ctx) }`);
    return { name: a.name || spec, ...a };
  }
  if (BY_EXT[extname(spec).toLowerCase()] && existsSync(expandHome(spec))) return { ...BY_EXT[extname(spec).toLowerCase()], impliedPath: spec };
  throw new Error(`no adapter "${spec}". Built in: ${BUILT_IN.map((a) => a.name).join(", ")}; or give a .js file, or a .json/.jsonl/.csv data file.`);
}

/**
 * Import an adapter module. A plain .js file outside a "type": "module" package is CommonJS to Node 18 and 20
 * (Node 22 detects ES syntax by itself), so an adapter written with `import`/`export` would fail there: load a
 * copy named .mjs instead. Relative imports in the adapter then resolve from the copy's folder, so the copy
 * sits next to the original.
 */
async function importModule(file) {
  try { return await import(pathToFileURL(file).href); }
  catch (e) {
    if (!/Cannot use import statement outside a module|Unexpected token 'export'/.test(e.message) || !file.endsWith(".js")) throw e;
    const copy = join(dirname(file), `.${basename(file, ".js")}.agent-afterlife.mjs`);
    writeFileSync(copy, readFileSync(file));
    try { return await import(pathToFileURL(copy).href); } finally { rmSync(copy, { force: true }); }
  }
}

/** Run one adapter and return its sessions; with `since` (ms), only those active since then. */
export async function runAdapter(adapter, path, { since, options = {}, log = () => {} } = {}) {
  const where = adapter.remote ? path || adapter.defaultPath : expandHome(path || adapter.impliedPath || adapter.defaultPath || "");
  if (!where) throw new Error(`${adapter.name} needs ${adapter.remote ? "a target, for example owner/repo" : "a path"}`);
  if (!adapter.remote && !existsSync(where)) throw new Error(`${adapter.name}: ${where} does not exist`);
  const ctx = helpers({ since, options, log });
  const out = [];
  const got = await adapter.sessions(where, ctx);
  for await (const s of got || []) if (s && (since === undefined || toMs(s.end ?? s.start) >= since)) out.push(s);
  return out;
}

/** What an adapter's sessions(path, ctx) receives as ctx. */
export function helpers({ since, options = {}, log = () => {} } = {}) {
  return {
    track,
    shellEvents,
    parseCsv,
    since,
    options,
    log,
    home: homedir(),
    /** Every file under dir (recursive) whose path matches re, skipping files untouched since `since`. */
    async files(dir, re = /./, { maxDepth = 6 } = {}) {
      const out = [];
      async function walk(d, depth) {
        let entries;
        try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const p = join(d, e.name);
          if (e.isDirectory()) { if (depth < maxDepth && e.name !== "node_modules" && !e.name.startsWith(".git")) await walk(p, depth + 1); }
          else if (re.test(p)) {
            if (since !== undefined) { try { if (statSync(p).mtimeMs < since) continue; } catch { continue; } }
            out.push(p);
          }
        }
      }
      if (existsSync(dir) && statSync(dir).isFile()) return re.test(dir) ? [dir] : [];
      await walk(dir, 0);
      return out.sort();
    },
    /** The lines of a JSON Lines file, parsed; bad lines are skipped. `filter` (a string) skips lines without it, before parsing. */
    async *lines(file, filter) {
      const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line || (filter && !(Array.isArray(filter) ? filter.some((f) => line.includes(f)) : line.includes(filter)))) continue;
        try { yield JSON.parse(line); } catch { /* a torn or partial line */ }
      }
    },
  };
}

export function expandHome(p) { return p && p.startsWith("~") ? join(homedir(), p.slice(1)) : p; }
