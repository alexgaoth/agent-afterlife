// Adapter for aider: .aider.chat.history.md files found under the given folder (default: the current folder).
//
// Format assumed, from aider's source (aider/io.py, aider/coders/base_coder.py):
//   "# aider chat started at 2026-01-05 09:12:00"   starts a session (local time; the only time stamp in the file)
//   "#### <text>"                                    the user's message; a multi-line message is consecutive "#### " lines
//   "> Applied edit to <file>"                       one file edit
//   "> Commit <hash> <message>"                      a commit aider made
//   "> Tokens: 1.2k sent, 340 received. Cost: $0.01 message, $0.05 session."   usage after each reply
//   "> Model: <name> ..." or "> Main model: <name> ..."   in the start-up banner
//   "#### /run <command>" or "#### /test <command>" or "#### !<command>"   shell commands the user ran
// Everything else (the assistant's replies, other "> " notes) is ignored. Session name: the folder that holds the history file.
//
// Aider logs no time per message, so each session is placed at its start time and hours come out near zero
// (the merit hours term does nothing); counts are still right. Uncertain: wording of the banner and commit lines
// varies between aider versions; checked against the source only, no real log was available.
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

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
    for (const file of await ctx.files(dir, /\.aider\.chat\.history\.md$/)) {
      try {
        const name = basename(resolve(dirname(file))) || "aider";
        const text = await readFile(file, "utf8");
        let t = null, model, tokens = 0, cost = 0, inPrompt = false;
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
            model = undefined; tokens = 0; cost = 0; inPrompt = false;
            continue;
          }
          if (!t) continue;
          if (line.startsWith("#### ") || line === "####") {
            const body = line.slice(5).trim();
            if (!inPrompt) {
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
          let m;
          if (/^> Applied edit to /.test(line)) t.count("edits", 1, at);
          else if (/^> Commit [0-9a-f]{6,}/.test(line)) t.count("commits", 1, at);
          else if ((m = /^> (?:Main model|Model): (\S+)/.exec(line))) model ??= m[1];
          else if ((m = /^> Tokens: ([\d.,]+[kKmM]?) sent(?:.*?, ([\d.,]+[kKmM]?) received)?/.exec(line))) {
            tokens += number(m[1]) + number(m[2] || 0);
          }
          if (/^> .*Cost: \$/.test(line)) {                  // on the Tokens line, or on the next line after it
            const c = /Cost: \$([\d.]+) message/.exec(line);
            if (c) cost += parseFloat(c[1]);
          }
        }
        finish();
      } catch (e) { ctx.log(`skipping ${basename(file)}: ${e.message}`); }
    }
    return sessions;
  },
};
