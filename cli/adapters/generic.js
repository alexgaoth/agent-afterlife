// Generic importers: JSON, JSON Lines and CSV. Any workflow that can write a file can use them.
//
// Each record is one of three shapes (column names are case-insensitive; the first match wins):
//   a SESSION  has a start:   name, start [, end, alive|status, merit, score, url, epitaph, any numbers]
//   an EVENT   has a time:    name, time [, kind, n]          e.g. {"agent":"Ada","time":"...","kind":"commit"}
//   a DAY      has a date:    name, date [, any numbers]      e.g. one row per agent per day
// A session record is one agent life. Event and day records with the same name (and the same session id, if
// there is one) are one agent life.
import { readFile } from "node:fs/promises";
import { track, toMs } from "../core.js";

const F = {
  name: ["name", "agent", "agent_name", "agentname", "who", "author", "assignee"],
  session: ["session", "session_id", "sessionid", "run", "run_id", "thread", "conversation"],
  start: ["start", "started", "started_at", "start_time", "born", "begin", "created_at", "created", "first_seen"],
  end: ["end", "ended", "ended_at", "end_time", "finished_at", "closed_at", "completed", "completed_at", "resolved", "canceled", "last_seen", "updated_at"],
  time: ["time", "timestamp", "ts", "at", "when", "datetime"],
  date: ["date", "day"],
  kind: ["kind", "type", "event", "action"],
  n: ["n", "count", "amount", "value", "qty"],
};
const SPECIAL = new Set([...Object.values(F).flat(), "id", "alive", "status", "url", "epitaph", "score", "stats"]);

function pick(row, key) {
  for (const k of F[key]) if (row[k] !== undefined && row[k] !== "") return row[k];
  return undefined;
}
const lower = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase(), v]));

/** Records (plain objects) to sessions. */
export function rowsToSessions(records) {
  const groups = new Map();
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue;
    const r = lower(raw);
    const name = String(pick(r, "name") ?? "Unnamed");
    // A session row is one life by itself; events and day rows with one name (and session id) make one life.
    const sid = pick(r, "session") ?? r.id;
    const key = sid !== undefined ? `${name}\u0000${sid}` : pick(r, "start") !== undefined ? `\u0001${groups.size}` : `${name}\u0000`;
    if (!groups.has(key)) groups.set(key, { name, rows: [] });
    groups.get(key).rows.push(r);
  }
  const out = [];
  for (const { name, rows } of groups.values()) {
    // Hours: events count the gaps between them (up to 15 minutes); sessions their span; a column wins.
    const onlyEvents = rows.every((r) => pick(r, "start") === undefined && pick(r, "time") !== undefined);
    const t = track({ name, idleMinutes: onlyEvents ? 15 : -1 });
    let alive, score, url, epitaph;
    const numbers = (r) => {
      const o = {};
      for (const [k, v] of Object.entries(r)) if (!SPECIAL.has(k) && typeof v === "number" && Number.isFinite(v)) o[k] = v;
      if (r.stats && typeof r.stats === "object") for (const [k, v] of Object.entries(r.stats)) if (typeof v === "number") o[k] = v;
      return o;
    };
    for (const r of rows) {
      if (r.alive !== undefined) alive = r.alive === true || r.alive === "true" || r.alive === 1;
      if (typeof r.status === "string") alive = /^(alive|running|active|open|in.?progress)$/i.test(r.status) ? true : alive ?? false;
      score = typeof r.score === "number" ? r.score : score;
      url = typeof r.url === "string" ? r.url : url;
      epitaph = typeof r.epitaph === "string" ? r.epitaph : epitaph;
      const start = pick(r, "start"), time = pick(r, "time"), date = pick(r, "date");
      if (start !== undefined) {                                  // a session
        const end = pick(r, "end") ?? start;
        t.at(start); t.at(end);
        const nums = numbers(r);
        if (nums.hours === undefined && toMs(end) > toMs(start)) nums.hours = (toMs(end) - toMs(start)) / 36e5;
        for (const [k, v] of Object.entries(nums)) t.count(k, v, end);
      } else if (time !== undefined) {                            // an event
        const kind = pick(r, "kind");
        const n = Number(pick(r, "n") ?? 1);
        if (kind !== undefined) t.count(String(kind).trim().toLowerCase().replace(/\s+/g, "_"), Number.isFinite(n) ? n : 1, time);
        else t.at(time);
        for (const [k, v] of Object.entries(numbers(r))) t.count(k, v, time);
      } else if (date !== undefined) {                            // a day
        const noon = `${String(date).slice(0, 10)}T12:00:00`;
        t.at(noon);
        for (const [k, v] of Object.entries(numbers(r))) t.count(k, v, noon);
      }
    }
    const s = t.session({ ...(alive !== undefined ? { alive } : {}), ...(score !== undefined ? { score } : {}), ...(url ? { url } : {}), ...(epitaph ? { epitaph } : {}) });
    if (s) out.push(s);
  }
  return out;
}

/** A small CSV parser: quotes, "" escapes, newlines in quotes, CRLF, and tab-separated files. */
export function parseCsv(text) {
  const sep = text.split(/\r?\n/, 1)[0].includes("\t") && !text.split(/\r?\n/, 1)[0].includes(",") ? "\t" : ",";
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), typed(r[i] ?? "")])));
}
function typed(v) {
  const s = v.trim();
  if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s)) return Number(s);
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === "true";
  return s;
}

function records(doc) {
  if (Array.isArray(doc)) return doc;
  if (doc && typeof doc === "object") {
    if (doc.schema === "agent-afterlife/1") throw new Error("this file is already an Agent Afterlife document: use `serve` or `build` on it directly");
    for (const k of ["agents", "sessions", "rows", "events", "data", "items", "records"]) if (Array.isArray(doc[k])) return doc[k];
  }
  throw new Error("expected an array of records, or an object with an array under agents, sessions, rows or events");
}

export const json = {
  name: "json",
  description: "A JSON file: an array of sessions, events or day rows",
  async sessions(path) { return rowsToSessions(records(JSON.parse(await readFile(path, "utf8")))); },
};

export const jsonl = {
  name: "jsonl",
  description: "A JSON Lines file: one session, event or day row per line",
  async sessions(path) {
    const lines = (await readFile(path, "utf8")).split(/\r?\n/);
    const recs = [];
    lines.forEach((l, i) => { if (l.trim()) try { recs.push(JSON.parse(l)); } catch { throw new Error(`${path}:${i + 1} is not JSON`); } });
    return rowsToSessions(recs);
  },
};

export const csv = {
  name: "csv",
  description: "A CSV or TSV file with a header row: sessions, events or day rows",
  async sessions(path) { return rowsToSessions(parseCsv(await readFile(path, "utf8"))); },
};
