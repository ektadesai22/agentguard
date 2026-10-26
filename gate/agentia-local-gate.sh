#!/usr/bin/env sh
# AgentGuard gate script for the Copado Agentia local quality gate.
#
# IMPORTANT: Copado's public docs do not yet document where the local quality gate looks for a
# repo-owned script, which command triggers it, or how it reads exit codes. Confirm the exact
# registration on your machine with `agentia setup` (local quality gates step) and
# `agentia cicd work --help` before relying on this script. Until confirmed, treat the wiring
# as unverified.
#
# Contract: exit 0 = PASS/WARN (continue), nonzero = BLOCK (2) or ERROR (3) (stop the step).
# Prefers the project's local agentguard binary; falls back to the Agentia plugin
# (`agentia agentguard check`). Base ref: AGENTGUARD_BASE (default origin/main).

BASE=${AGENTGUARD_BASE:-origin/main}
REPO=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$REPO" || exit 3

if [ -f "$REPO/node_modules/.bin/agentguard" ]; then
  node "$REPO/node_modules/.bin/agentguard" check --base "$BASE" "$@"
  STATUS=$?
elif command -v agentia >/dev/null 2>&1; then
  agentia agentguard check --base "$BASE" "$@"
  STATUS=$?
else
  echo "AgentGuard ERROR: neither node_modules/.bin/agentguard nor the agentia CLI was found." >&2
  exit 3
fi

case $STATUS in
  0) echo "AgentGuard: PASS/WARN - quality gate passed."; exit 0 ;;
  2) echo "AgentGuard: BLOCK - behaviour regressed. Quality gate failed." >&2; exit 2 ;;
  *) echo "AgentGuard: ERROR (exit $STATUS) - change could not be verified. Quality gate failed." >&2; exit 3 ;;
esac
