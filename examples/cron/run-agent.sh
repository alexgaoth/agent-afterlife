#!/usr/bin/env bash
# Run one agent job and record it: one CSV row per run, and the run's own log in logs/<run id>/.
# crontab (every night at 02:00):  0 2 * * *  /path/to/run-agent.sh triage
#
# AGENT_CMD is whatever runs your agent; it should write one JSON line per event to $RUN_LOG, for example
#   {"time":"2026-01-05T02:01:10Z","kind":"tool_call"}  {"time":"...","kind":"pr_merged"}
set -u
ROLE=${1:-triage}
DIR=${AFTERLIFE_RUNS_DIR:-$(cd "$(dirname "$0")" && pwd)}   # where runs.csv and logs/ live
RUN_ID="r-$(date -u +%m%d-%H%M)"
export RUN_LOG="$DIR/logs/$RUN_ID/events.jsonl"; mkdir -p "$(dirname "$RUN_LOG")"
STARTED=$(date -u +%FT%TZ)
bash -c "${AGENT_CMD:-echo set AGENT_CMD to run your agent}"; STATUS=$?
FINISHED=$(date -u +%FT%TZ)
PRS=$(grep -c '"pr_merged"' "$RUN_LOG" 2>/dev/null || echo 0)
[ -f "$DIR/runs.csv" ] || echo "run_id,agent,start,end,exit_code,prs_merged" > "$DIR/runs.csv"
echo "$RUN_ID,$ROLE,$STARTED,$FINISHED,$STATUS,$PRS" >> "$DIR/runs.csv"
