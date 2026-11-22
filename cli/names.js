// 名号: the names the temple's pilgrims can say aloud. The voice pack (temple/voices) holds a recording of each:
// 290 historical Chinese generals, most famous first. A pilgrim who stops before a statue says its name, then a line
// about it; for a name the pack does not have, it says a line without a name. Nothing here renames your agents.
// If you would like them named aloud, give your next agents names from this list in the harness you use.
import { readFileSync } from "node:fs";

const pack = JSON.parse(readFileSync(new URL("../temple/voices/manifest.json", import.meta.url), "utf8"));

/** The names the pilgrims can say, most famous first: [{ name, pinyin }]. */
export const SPOKEN = Object.entries(pack.names)
  .filter(([, n]) => Object.keys(n.dur || {}).length)
  .sort(([, a], [, b]) => a.file.localeCompare(b.file))
  .map(([name, n]) => ({ name, pinyin: n.pinyin || "" }));
const spokenSet = new Set(SPOKEN.map((n) => n.name));

/** How an agent gets its name in each source, and how to give it one from the list (example: 岳飞). */
export const HOW = {
  "claude-code": "the session's name. Start a session with `claude -n 岳飞`, or type `/rename 岳飞` in one.",
  codex: "the folder Codex runs in. Run it in a folder or git worktree named 岳飞; or give the thread a title and import with --opt names=title.",
  droid: "the folder Droid runs in. Run it in a folder or git worktree named 岳飞; or import with --opt names=title to use the session's title.",
  gemini: "the project's folder. Run it in a folder named 岳飞; or import with --opt names=title to use each session's summary.",
  cursor: "\"Cursor\" for every chat. Rename a chat 岳飞 and import with --opt names=title.",
  aider: "the folder that holds the chat history. Work in a folder or git worktree named 岳飞.",
  cline: "the workspace folder. Open the work in a folder or git worktree named 岳飞.",
  continue: "the workspace folder. Open the work in a folder or git worktree named 岳飞.",
  openhands: "the workspace folder. Use a workspace named 岳飞; or import with --opt names=title.",
  "openai-agents": "the trace's name, else the agent's. Write `with trace(\"岳飞\"):` or `Agent(name=\"岳飞\", ...)`.",
  langsmith: "the root run's name. Name the run 岳飞; or tag it 岳飞 and import with --opt names=tag.",
  langfuse: "the trace's name. Name the trace 岳飞; or tag it 岳飞 and import with --opt names=tag.",
  json: "the name field of each record. Put 岳飞 there.",
  jsonl: "the name field of each record. Put 岳飞 there.",
  csv: "the name column. Put 岳飞 there.",
};
for (const k of ["git", "github", "copilot-agent", "linear", "jira"]) {
  HOW[k] = "a repository, a person or the tool itself, not an agent you name. Nothing to change here.";
}

/** Which of a document's agent names the pilgrims can say, and unused names to give the next agents. */
export function nameReport(doc, { suggest = 12 } = {}) {
  const names = [...new Set(doc.agents.map((a) => a.name).filter((n) => n && n !== "Unnamed"))];
  const spoken = names.filter((n) => spokenSet.has(n)), silent = names.filter((n) => !spokenSet.has(n));
  const used = new Set(names);
  return { names, spoken, silent, next: SPOKEN.filter((n) => !used.has(n.name)).slice(0, suggest) };
}

/** The whole list, for a terminal: four to a line, with pinyin. */
export function listText() {
  const cells = SPOKEN.map((n, i) => `${String(i + 1).padStart(3)} ${n.name} ${n.pinyin}`);
  const width = Math.max(...cells.map(cellWidth)) + 2, rows = [];
  for (let i = 0; i < cells.length; i += 4) rows.push(cells.slice(i, i + 4).map((c) => c + " ".repeat(Math.max(1, width - cellWidth(c)))).join("").trimEnd());
  return rows.join("\n");
}
/** A Chinese character takes two columns in a terminal. */
const cellWidth = (s) => [...s].reduce((w, c) => w + (/[㐀-鿿]/.test(c) ? 2 : 1), 0);
