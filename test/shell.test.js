import { test } from "node:test";
import assert from "node:assert/strict";
import { shellEvents } from "../cli/adapters/shell.js";

const ev = (c) => shellEvents(c);
test("shellEvents counts commits, PRs and test runs, and nothing in messages", () => {
  assert.deepEqual(ev("git add -A && git commit -m 'fix: gh pr merge' && gh pr create --fill"), { commits: 1, prs_opened: 1, prs_merged: 0, tests: 0 });
  assert.equal(ev("git -C ~/repo -c user.name=x commit -qam wip").commits, 1);
  assert.equal(ev("cd x; GIT_AUTHOR_NAME=a git commit --amend --no-edit").commits, 1);
  assert.equal(ev("git log --grep commit; git show HEAD").commits, 0);
  assert.equal(ev("git commit -F - <<'EOF'\ngit commit again\ngh pr merge 3\nEOF\ngh pr merge 4 --squash").commits, 1);
  assert.equal(ev("git commit -F - <<'EOF'\ngit commit again\ngh pr merge 3\nEOF\ngh pr merge 4 --squash").prs_merged, 1);
  assert.equal(ev('echo "git commit" | cat').commits, 0);
  assert.equal(ev("npm test && npm run test:unit && pytest -q && cargo nextest run && go test ./... && node --test").tests, 6);
  assert.equal(ev("npm install && cargo build").tests, 0);
  assert.equal(ev("/usr/bin/git commit -m x").commits, 1);
  assert.deepEqual(ev(""), { commits: 0, prs_opened: 0, prs_merged: 0, tests: 0 });
  assert.deepEqual(ev(undefined), { commits: 0, prs_opened: 0, prs_merged: 0, tests: 0 });
});
