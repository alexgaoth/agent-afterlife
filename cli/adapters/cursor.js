// Adapter for Cursor: the SQLite database state.vscdb in Cursor's globalStorage.
//   macOS  ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb
//   Linux  ~/.config/Cursor/User/globalStorage/state.vscdb      (Windows: %APPDATA%/Cursor/User/globalStorage)
// Read with the `sqlite3` command-line tool (execFile, `-readonly -json`); without it the adapter stops with an error.
//
// Format assumed (Cursor has no public spec; this follows what community tools read from the file):
//   table cursorDiskKV (key TEXT, value BLOB), JSON values:
//   "composerData:<id>"            one chat/agent session { composerId, name?, createdAt (ms), lastUpdatedAt (ms),
//                                  modelConfig?: { modelName } }
//   "bubbleId:<composerId>:<id>"   one message { type: 1 (user) | 2 (assistant), createdAt (ISO text), tokenCount?: { inputTokens,
//                                  outputTokens }, toolFormerData?: { name, params } }
// Only the fields above are pulled out (with json_extract), so message text never leaves the database.
// Session name: the session's `name` (its title), else "Cursor".
// Counted: prompts = type-1 bubbles; tool_calls = bubbles with toolFormerData; edits = edit/write/patch tools; commands = terminal tools.
//
// Uncertain, docs-free: key names and fields change between Cursor versions. Older versions kept the messages inline in composerData; those are not read. A session with no bubbles still
// appears, with its created and last-updated times. Not verified against a real database (none on this machine).
import { execFile } from "node:child_process";
import { platform } from "node:os";
import { stat } from "node:fs/promises";

const DB = "Cursor/User/globalStorage/state.vscdb";
const defaultPath = platform() === "darwin" ? `~/Library/Application Support/${DB}`
  : platform() === "win32" ? `~/AppData/Roaming/${DB}` : `~/.config/${DB}`;
const EDIT_TOOL = /(edit|write|replace|patch|create_file|delete_file)/i;
const TERMINAL_TOOL = /(terminal|shell|run_command|bash)/i;

function sqlite(db, query) {
  return new Promise((resolve, reject) => {
    execFile("sqlite3", ["-readonly", "-json", db, query], { maxBuffer: 1 << 29, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === "ENOENT") return reject(new Error("the sqlite3 command-line tool is not installed or not on PATH; install it (for example `brew install sqlite` or `apt install sqlite3`) and run again"));
        return reject(new Error(`sqlite3 failed: ${String(stderr || err.message).trim().split("\n")[0]}`));
      }
      try { resolve(stdout.trim() ? JSON.parse(stdout) : []); } catch { reject(new Error("sqlite3 returned output that is not JSON")); }
    });
  });
}

const json = (text) => { try { return JSON.parse(text); } catch { return null; } };

export default {
  name: "cursor",
  description: "Cursor chat and agent sessions (state.vscdb; needs the sqlite3 tool). --opt names=title",
  defaultPath,
  merit: "prs_merged*5 + prs_opened*2 + commits + edits/20 + hours/4",
  async sessions(path, ctx) {
    const [db] = await ctx.files(path, /state\.vscdb$/);
    if (!db) throw new Error(`no state.vscdb under ${path}`);
    if (!(await stat(db).catch(() => null))) throw new Error(`cannot read ${db}`);
    const composers = await sqlite(db, "SELECT substr(key, 14) AS id, json_extract(CAST(value AS TEXT), '$.name') AS name, " +
      "json_extract(CAST(value AS TEXT), '$.createdAt') AS created, json_extract(CAST(value AS TEXT), '$.lastUpdatedAt') AS updated, " +
      "json_extract(CAST(value AS TEXT), '$.modelConfig.modelName') AS model " +
      "FROM cursorDiskKV WHERE key LIKE 'composerData:%'");
    const bubbles = new Map();
    const rows = await sqlite(db, "SELECT key, json_extract(CAST(value AS TEXT), '$.type') AS type, json_extract(CAST(value AS TEXT), '$.createdAt') AS created, " +
      "json_extract(CAST(value AS TEXT), '$.tokenCount.inputTokens') AS tin, json_extract(CAST(value AS TEXT), '$.tokenCount.outputTokens') AS tout, " +
      "json_extract(CAST(value AS TEXT), '$.toolFormerData.name') AS tool, " +
      "CASE WHEN json_extract(CAST(value AS TEXT), '$.toolFormerData.name') LIKE '%terminal%' OR json_extract(CAST(value AS TEXT), '$.toolFormerData.name') LIKE '%shell%' " +
      "THEN json_extract(CAST(value AS TEXT), '$.toolFormerData.params') END AS params " +
      "FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'");
    for (const r of rows) {
      const id = String(r.key).split(":")[1];
      if (!bubbles.has(id)) bubbles.set(id, []);
      bubbles.get(id).push(r);
    }
    const sessions = [];
    for (const c of composers) {
      try {
        const t = ctx.track({ name: (ctx.options.names === "title" && typeof c.name === "string" && c.name.trim()) || "Cursor" });
        t.at(c.created); t.at(c.updated);
        let tokens = 0;
        for (const b of bubbles.get(c.id) || []) {
          const at = b.created ?? undefined;
          if (b.type === 1) t.count("prompts", 1, at);
          else t.at(at);
          tokens += (Number(b.tin) || 0) + (Number(b.tout) || 0);
          if (typeof b.tool === "string" && b.tool) {
            t.count("tool_calls", 1, at);
            if (TERMINAL_TOOL.test(b.tool)) {
              t.count("commands", 1, at);
              const p = typeof b.params === "string" ? json(b.params) : b.params;
              const ev = ctx.shellEvents(p?.command);
              for (const k of ["commits", "prs_opened", "prs_merged", "tests"]) if (ev[k]) t.count(k, ev[k], at);
            } else if (EDIT_TOOL.test(b.tool)) t.count("edits", 1, at);
          }
        }
        if (tokens) t.count("tokens", tokens);
        if (typeof c.model === "string" && c.model) t.set("model", c.model);
        const s = t.session();
        if (s) sessions.push(s);
      } catch (e) { ctx.log(`skipping a session: ${e.message}`); }
    }
    return sessions;
  },
};
