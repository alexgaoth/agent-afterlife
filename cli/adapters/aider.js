// Adapter for aider: .aider.chat.history.md files found under the given folder (default: the current folder).
//
// Formats supported (all one markdown shape; aider has no version field in the file):
//   Read from Aider-AI/aider, aider/io.py (user lines, tool notes, append_chat_history) and aider/coders/base_coder.py
//   (usage report, "Applied edit to"), at v0.20.0, v0.50.0 and main (commit 5dc9490, tags up to v0.86.x):
//   "# aider chat started at 2026-01-05 09:12:00"   starts a session (local time; the only time stamp in the file)
//   "#### <text>"                                    the user's message; a multi-line message is consecutive "#### " lines.
//        aider writes every user line with two trailing spaces ("#### text  "); assistant replies are raw markdown, so a
//        reply can hold a "#### Heading" line. When a file has lines with the two trailing spaces, only those are user
//        lines; a file without them (edited by an editor that trims spaces) counts every "#### " line.
//        "#### <blank>" is an empty Enter and is not counted.
//   "> Applied edit to <file>"                       one file edit
//   "> Commit <hash> <message>"                      a commit aider made (repo.py; "Committing <file> before ..." is not one)
//   "> Tokens: 1.2k sent, 340 received. Cost: $0.01 message, $0.05 session."   usage after each reply (v0.50.0 and later,
//        "1,234" with commas; v0.8x may add ", N cache write, N cache hit" before "received"). With both cache counts the
//        report is two lines and the second line ("Cost: ...") has no "> " prefix, because only the first line is quoted.
//        v0.20.0 writes no usage line at all.
//   "> Model: <name> ..." or "> Main model: <name> ..."   in the start-up banner ("> Aider v0.x" is not read)
//   "#### /run <command>" or "#### /test <command>" or "#### !<command>"   shell commands the user ran
// Everything else (the assistant's replies, other "> " notes) is ignored. Session name: the folder that holds the history file.
// Unknown format: a non-empty history file with no "# aider chat started at" line is skipped and reported once.
//
// Aider logs no time per message, so each session is placed at its start time and hours come out near zero
// (the merit hours term does nothing); counts are still right. Checked against the source and synthetic fixtures only;
// no real log was available. The wording of notes can change between aider versions.
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { unknownFormats } from "./unknown.js";

function number(text) {
  const m = /^([\d,.]+)\s*([kKmM]?)$/.exec(String(text).trim());
  if (!m) return 0;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n * ({ k: 1e3, m: 1e6 }[m[2].toLowerCase()] || 1) : 0;
}

export default {
  name: "aider",
  description: "aider chat history (.aider.chat.history.md under the given folder, default the current folder)",
  defaultPath: ".",
  merit: "prs_merged*5 + prs_opened*2 + commits + edits/20 + hours/4",
  async sessions(dir, ctx) {
    const sessions = [];
    const unknown = unknownFormats("aider");
    for (const file of await ctx.files(dir, /\.aider\.chat\.history\.md$/)) {
      try {
        const name = basename(resolve(dirname(file))) || "aider";
        const text = await readFile(file, "utf8");
        if (!text.trim()) continue;
        if (!/^# aider chat started at /m.test(text)) { unknown.add(); continue; }
        unknown.recognized();
        const strict = /^#### .*\S {2}$/m.test(text);    // aider's own user lines end with two spaces
        let t = null, model, tokens = 0, cost = 0, inPrompt = false, sawTokens = false;
        const finish = () => {
          if (!t) return;
          if (model) t.set("model", model);
          if (tokens) t.count("tokens", tokens);
          if (cost) t.count("cost_usd", Math.round(cost * 1e4) / 1e4);
          const s = t.session();
          if (s) sessions.push(s);
        };
        let at;
        for (const line of text.split(/\r?\n/)) {
          const start = /^# aider chat started at (\d{4}-\d\d-\d\d)[ T](\d\d:\d\d(?::\d\d)?)/.exec(line);
          if (start) {
            finish();
            at = new Date(`${start[1]}T${start[2].length === 5 ? start[2] + ":00" : start[2]}`).getTime();   // local time
            t = Number.isNaN(at) ? null : ctx.track({ name });
            t?.at(at);
            model = undefined; tokens = 0; cost = 0; inPrompt = false; sawTokens = false;
            continue;
          }
          if (!t) continue;
          if ((line.startsWith("#### ") || line === "####") && (!strict || line === "####" || /\S {2}$/.test(line))) {
            const body = line.slice(5).trim();
            if (!inPrompt && body !== "<blank>") {
              const shell = /^(?:\/(?:run|test)\s+|!)(.+)$/.exec(body);
              if (shell) {
                t.count("commands", 1, at);
                if (/^\/test\b/.test(body)) t.count("tests", 1, at);
                const ev = ctx.shellEvents(shell[1]);
                for (const k of ["commits", "prs_opened", "prs_merged"]) if (ev[k]) t.count(k, ev[k], at);
                if (!/^\/test\b/.test(body) && ev.tests) t.count("tests", ev.tests, at);
              } else if (!body.startsWith("/")) t.count("prompts", 1, at);
            }
            inPrompt = true;
            continue;
          }
          inPrompt = false;
          const afterTokens = sawTokens; sawTokens = false;
          let m;
          if (/^> Applied edit to /.test(line)) t.count("edits", 1, at);
          else if (/^> Commit [0-9a-f]{6,}/.test(line)) t.count("commits", 1, at);
          else if ((m = /^> (?:Main model|Model): (\S+)/.exec(line))) model ??= m[1];
          else if ((m = /^> Tokens: ([\d.,]+[kKmM]?) sent(?:.*?, ([\d.,]+[kKmM]?) received)?/.exec(line))) {
            tokens += number(m[1]) + number(m[2] || 0);
            sawTokens = true;
          }
          if (/^> .*Cost: \$/.test(line) || (afterTokens && /^Cost: \$/.test(line))) {   // on the Tokens line, or on the next line (no "> " when the report has cache counts)
            const c = /Cost: \$([\d.]+) message/.exec(line);
            if (c) cost += parseFloat(c[1]);
          }
        }
        finish();
      } catch (e) { ctx.log(`skipping ${basename(file)}: ${e.message}`); }
    }
    unknown.finish(ctx);
    return sessions;
  },
};
