#!/usr/bin/env bash
# Cold start: run the README's quick-start commands as written, from an empty folder, with an empty npm
# cache and an empty home. Exits non-zero if any command fails or its output is wrong.
#
#   test/quickstart.sh                                   the published repository (github:alexgaoth/agent-afterlife)
#   test/quickstart.sh github:alexgaoth/agent-afterlife#<sha>   a given commit (CI uses the pull request's)
#
# BROWSER=none keeps `serve` and `demo` from opening a browser; nothing else differs from the README.
set -uo pipefail
SPEC=${1:-github:alexgaoth/agent-afterlife}
WORK=$(mktemp -d)
export HOME="$WORK/home" npm_config_cache="$WORK/npm-cache" npm_config_update_notifier=false BROWSER=none
mkdir -p "$HOME" "$WORK/cwd" && cd "$WORK/cwd" || exit 2
aa() { npx -y "$SPEC" "$@"; }
FAILED=0
ok()   { echo "  ok    $1"; }
bad()  { echo "  FAIL  $1"; FAILED=$((FAILED + 1)); }
kill_tree() { local c; for c in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$c"; done; kill "$1" 2>/dev/null; }

# serving <what> <args...>: start `serve`/`demo`, wait for its URL, fetch the page and the data, stop it.
serving() {
  local what=$1; shift
  local log="$WORK/serve.log"; : > "$log"
  aa "$@" > "$log" 2>&1 & local pid=$!; disown $pid 2>/dev/null
  local url="" i
  for i in $(seq 1 120); do url=$(grep -o 'http://[^ ]*' "$log" | head -1); [ -n "$url" ] && break; kill -0 $pid 2>/dev/null || break; sleep 0.5; done
  if [ -z "$url" ]; then bad "$what: no URL ($(tail -3 "$log" | tr '\n' ' '))"; kill_tree $pid; return; fi
  local base=${url%%/temple*}; base=${base%%/graveyard*}; base=${base%/}
  local page data
  page=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' "$url")
  data=$(curl -s --noproxy '*' "$base/data.json")
  if [ "$page" = 200 ] && { [[ "$*" == demo* ]] || [[ "$data" == *'"agent-afterlife/1"'* ]]; }; then ok "$what"; else bad "$what: page $page, data ${data:0:80}"; fi
  kill_tree $pid; sleep 0.3
}

echo "quickstart with $SPEC on node $(node --version), npm $(npm --version)"

# 1. Look at the demo.
serving "demo" demo

# The demo document as a template for your own, and the check.
aa demo --json > my-fleet.json 2>/dev/null && aa validate my-fleet.json >/dev/null 2>&1 && ok "demo --json + validate" || bad "demo --json + validate"
serving "serve my-fleet.json" serve my-fleet.json

# 2. Point it at your agents: a Claude Code store, in the place the importer looks.
P="$HOME/.claude/projects/-home-ada-code-demo-app"; mkdir -p "$P"
cat > "$P/11111111-aaaa-4aaa-8aaa-111111111111.jsonl" <<'EOF'
{"type":"user","uuid":"u1","message":{"role":"user","content":"Add a health check."},"timestamp":"2026-01-05T09:00:00.000Z","cwd":"/home/ada/code/demo-app","sessionId":"11111111-aaaa-4aaa-8aaa-111111111111"}
{"type":"assistant","uuid":"a1","message":{"model":"m","role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"git commit -m 'Add /health'"}}]},"timestamp":"2026-01-05T09:05:00.000Z","sessionId":"11111111-aaaa-4aaa-8aaa-111111111111"}
EOF
serving "serve claude-code" serve claude-code

# The one-line integration, then serve the events.
AGENT=Ada
echo "{\"agent\":\"$AGENT\",\"time\":\"$(date -u +%FT%TZ)\",\"kind\":\"commit\"}" >> ~/agent-events.jsonl
serving "serve events.jsonl" serve ~/agent-events.jsonl --merit "commit"

# Your own adapter (the one in ADAPTERS.md), with its runs in its default place.
mkdir -p "$HOME/.my-runner/runs"
echo '{ "agent": "Ada", "events": [{ "at": "2026-01-05T09:00:00Z", "type": "start" }, { "at": "2026-01-05T09:08:00Z", "type": "commit" }] }' > "$HOME/.my-runner/runs/run-1.json"
REF=main; [[ "$SPEC" == *#* ]] && REF=${SPEC#*#}
curl -s "https://raw.githubusercontent.com/alexgaoth/agent-afterlife/$REF/examples/my-adapter.js" -o my-adapter.js 2>/dev/null
if [ -s my-adapter.js ]; then serving "serve ./my-adapter.js" serve ./my-adapter.js; else bad "fetch examples/my-adapter.js"; fi

# Any agent that commits.
mkdir -p ~/code/app && git -C ~/code/app init -q && echo x > ~/code/app/a.txt && git -C ~/code/app add a.txt \
  && git -C ~/code/app -c user.name=Ada -c user.email=ada@example.com commit -q -m $'Add a\n\nCo-authored-by: Claude <noreply@anthropic.com>'
serving "serve git ~/code" serve git ~/code

# Pull requests by agents (needs a token or a gh login; CI has GITHUB_TOKEN).
if [ -n "${GITHUB_TOKEN:-}" ]; then serving "serve github" serve github alexgaoth/agent-afterlife; else echo "  skip  serve github (no GITHUB_TOKEN)"; fi

# 3. Decide what counts.
serving "serve claude-code --merit" serve claude-code --merit "prs_merged*5 + commits + hours/4"

# 4. Publish it.
aa build claude-code --out site --anonymize > /dev/null 2>&1 && [ -f site/data.json ] && [ -f site/temple/index.html ] \
  && ! grep -q '"Ada\|demo-app' site/data.json && ok "build --anonymize" || bad "build --anonymize"
mkdir -p repo && (cd repo && git init -q && aa init > /dev/null 2>&1) && [ -f repo/.github/workflows/afterlife.yml ] && ok "init" || bad "init"
mkdir -p repo2 && (cd repo2 && git init -q && aa init --source data/agents.csv > /dev/null 2>&1) && [ -f repo2/data/agents.csv ] && ok "init --source data/agents.csv" || bad "init --source"

# Reference commands.
aa import claude-code > /dev/null 2>&1 && aa validate afterlife.json > /dev/null 2>&1 && ok "import + validate" || bad "import + validate"
aa adapters 2>/dev/null | grep -q "claude-code" && ok "adapters" || bad "adapters"

rm -rf "$WORK"
[ $FAILED = 0 ] && echo "quickstart: all passed" || { echo "quickstart: $FAILED failed"; exit 1; }
