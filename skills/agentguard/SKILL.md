---
name: agentguard
description: Behavioural quality gate for Agentforce agents. Use before committing, publishing or submitting any change to agent metadata (Agent Script aiAuthoringBundles, topics/subagents, actions, prompt templates) on a Copado user story.
---

# AgentGuard

Agent changes can deploy cleanly and still route customers to the wrong subagent, run the wrong action
or weaken a refusal. AgentGuard runs the curated suite (`suites/golden.yaml`) on the changed agent with
the Agentforce Studio test runner and compares it with the recorded baseline (`runs/baseline-recorded.json`).

## When agent metadata changed
1. Run `agentia agentguard check` (or `agentguard check`). It is also the Copado local quality gate, so
   `agentia cicd work test` and `agentia cicd work submit` run it automatically.
2. Read the verdict: exit 0 PASS/WARN, 2 BLOCK (behaviour regressed), 3 ERROR (could not verify; treat as blocked).
3. On BLOCK: explain which requests are misrouted and which actions changed, quote the suggested fix from
   `.agentguard/report/report.md`, and propose the smallest edit to the Agent Script. Re-run the gate.

## Never
- Never use `--skip-local-tests`, edit `agentguard.policy.yaml`, or delete or weaken cases in `suites/` to get a pass.
- Never present a replay (`--replay-candidate`) as a live run.
