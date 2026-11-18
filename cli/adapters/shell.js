// What a shell command did, for adapters that read agent transcripts.
//
//   shellEvents("git add -A && git commit -m x && gh pr create --fill")
//   → { commits: 1, prs_opened: 1, prs_merged: 0, tests: 0 }
//
// It reads each simple command (split on && || ; | and newlines; heredoc bodies dropped) and looks at the
// program and its subcommand, so `git log --grep commit` or a commit message that says "gh pr merge" does not count.
const WRAPPERS = new Set(["sudo", "time", "command", "env", "nohup", "exec", "builtin"]);
const GIT_OPTS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);
const TESTS = [
  [/^(npm|pnpm|yarn|bun)$/, (a) => a[0] === "test" || a[0] === "t" || (a[0] === "run" && /^test/.test(a[1] || ""))],
  [/^(pytest|py\.test|jest|vitest|mocha|rspec|phpunit|ctest|tox|nox)$/, () => true],
  [/^(cargo|go|mvn|gradle|gradlew|\.\/gradlew|dotnet|mix|swift|deno|bazel|make)$/, (a) => a.includes("test") || a.includes("nextest")],
  [/^(node)$/, (a) => a.includes("--test")],
  [/^(python3?|uv|uvx|poetry)$/, (a) => a.includes("pytest") || (a[0] === "-m" && a[1] === "unittest")],
];

export function shellEvents(command) {
  const out = { commits: 0, prs_opened: 0, prs_merged: 0, tests: 0 };
  if (typeof command !== "string" || !command) return out;
  for (const part of simpleCommands(command)) {
    let t = part.trim().split(/\s+/).filter(Boolean);
    while (t.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0]) || WRAPPERS.has(t[0]) || t[0] === "(" || t[0] === "{")) t = t.slice(1);
    if (!t.length) continue;
    const prog = t[0].replace(/^.*\//, ""), args = t.slice(1);
    if (prog === "git") {
      let i = 0;
      while (i < args.length && args[i].startsWith("-")) i += GIT_OPTS_WITH_VALUE.has(args[i]) ? 2 : 1;
      if (args[i] === "commit") out.commits++;
    } else if (prog === "gh" && args[0] === "pr") {
      if (args[1] === "create") out.prs_opened++;
      else if (args[1] === "merge") out.prs_merged++;
    } else if (TESTS.some(([re, ok]) => re.test(t[0]) && ok(args))) out.tests++;
  }
  return out;
}

function simpleCommands(cmd) {
  // Drop heredoc bodies: everything between <<WORD (or <<'WORD', <<-"WORD") and a line that is WORD.
  const lines = cmd.split("\n"), kept = [];
  let end = null;
  for (const line of lines) {
    if (end !== null) { if (line.trim() === end) end = null; continue; }
    kept.push(line);
    const m = /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/.exec(line);
    if (m) end = m[1];
  }
  // Drop quoted strings so that a message cannot look like a command, then split.
  return kept.join("\n").replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''").split(/&&|\|\||[;|\n]|\$\(|`/);
}
