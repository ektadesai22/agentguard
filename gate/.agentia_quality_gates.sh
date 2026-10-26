#!/usr/bin/env bash
set -uo pipefail
# Local Agentia quality gates (macOS / Linux) - AgentGuard behavioural gate for Agentforce agents.
# Agentia runs this from the repo root during `agentia cicd work test` and `agentia cicd work submit`
# (unless --skip-local-tests). Any non-zero exit fails the step.
# AgentGuard exit codes: 0 PASS/WARN, 2 BLOCK (behaviour regressed), 3 ERROR (unverified = fail closed).

echo "## AgentGuard: behavioural gate for the Order_Concierge agent"
[ -f agentguard.config.yaml ] || { echo "AgentGuard ERROR: agentguard.config.yaml not found - refusing to pass."; exit 3; }
command -v agentguard >/dev/null 2>&1 || { echo "AgentGuard ERROR: agentguard CLI not installed - refusing to pass."; exit 3; }

BASELINE="runs/baseline-recorded.json"
if [ -f "$BASELINE" ]; then
  echo "Baseline: recorded run $BASELINE | Candidate: live run in ag-dev"
  agentguard check --replay-baseline "$BASELINE"; rc=$?
else
  echo "No recorded baseline yet: running baseline and candidate live in the configured orgs"
  agentguard check; rc=$?
fi
case "$rc" in
  0) echo "AgentGuard PASS - report: .agentguard/report/report.html" ;;
  2) echo "AgentGuard BLOCK - agent behaviour regressed. See .agentguard/report/report.html"; exit 2 ;;
  *) echo "AgentGuard ERROR (exit $rc) - result unverified, refusing to pass."; exit "$rc" ;;
esac

