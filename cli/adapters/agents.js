// Which AI agent made a commit or a pull request, from the names and trailers it leaves behind.
// Order matters: the first match wins. Add yours with --opt agent=<regex>=<Name> on the git and github adapters.
export const KNOWN = [
  ["Claude", /\bclaude\b|anthropic\.com|claude-code/i],
  ["Copilot", /copilot/i],
  ["Codex", /\bcodex\b|chatgpt-codex/i],
  ["Cursor", /\bcursor(?:agent|-agent|\[bot\])?\b/i],
  ["Devin", /\bdevin(?:-ai)?\b/i],
  ["Aider", /\baider\b/i],
  ["Jules", /\bjules\b|google-labs-jules/i],
  ["Gemini", /\bgemini\b/i],
  ["OpenHands", /openhands|all-hands/i],
  ["Droid", /factory-droid|\bfactory\.ai\b|\bdroid\b/i],
  ["Amp", /\bampcode\b|\bamp\[bot\]|amp@/i],
  ["Windsurf", /windsurf|codeium/i],
  ["Cline", /\bcline\b/i],
  ["Roo", /\broo[- ]?code\b/i],
  ["Goose", /\bgoose\b/i],
  ["Sweep", /\bsweep(?:-ai)?\b/i],
];

/** The agent named in any of the texts, or null. `extra` is a list of [name, regex] tried first. */
export function agentOf(texts, extra = []) {
  const all = [...extra, ...KNOWN];
  for (const t of texts) if (t) for (const [name, re] of all) if (re.test(t)) return name;
  return null;
}

/** The lines of a commit message or PR body that name a tool: trailers and "Generated with" footers. */
export function credits(body = "") {
  return String(body).split("\n").filter((l) => /^\s*(co-authored-by|generated-by|assisted-by|ai-agent|agent|tool)\s*:/i.test(l) || /generated (with|by)|🤖/i.test(l));
}

/** --opt agent=<regex>=<Name> → [[Name, RegExp]] (several separated by ";"). */
export function extraAgents(opt) {
  if (!opt) return [];
  return String(opt).split(";").filter(Boolean).map((p) => {
    const i = p.lastIndexOf("=");
    if (i < 1) throw new Error(`--opt agent must be <regex>=<Name>, not "${p}"`);
    return [p.slice(i + 1), new RegExp(p.slice(0, i), "i")];
  });
}
