---
name: agentguard
description: Behavioural quality gate for Agentforce agents. Use before committing, publishing or submitting any change to agent metadata (Agent Script aiAuthoringBundles, topics/subagents, actions, prompt templates) on a Copado user story, and whenever the user asks to submit, publish or promote such a change.
---

# AgentGuard

Agent changes can deploy cleanly and still route customers to the wrong subagent, run the wrong action
or weaken a refusal. AgentGuard runs the curated suite (`suites/golden.yaml`) on the changed agent with
the Agentforce Studio test runner and compares it with the recorded baseline (`runs/baseline-recorded.json`).

## Tools
- MCP (preferred for AI coding agents): the `agentguard` MCP server gives `agentguard_check` (run the gate),
  `agentguard_report` (latest report and suggested fix) and `agentguard_policy` (what the gate enforces, read-only).
- CLI: `agentia agentguard check` (Agentia plugin) or `agentguard check`.
- It is also the Copado local quality gate, so `agentia cicd work test` and `agentia cicd work submit` run it automatically.

## When agent metadata changed, or before submit / publish / promote
1. Find the active Copado user story (Agentia MCP or `agentia cicd work get --json`) and pass it as `workItem`.
2. Run `agentguard_check` (a live run takes a few minutes; tell the user you are waiting for it).
3. Read the verdict: exit 0 PASS/WARN, 2 BLOCK (behaviour regressed), 3 ERROR (could not verify; treat as blocked).
4. On PASS/WARN: continue with the Agentia workflow (`work test` → `work publish` → `work submit`).
5. On BLOCK or ERROR: stop. Do not submit. Tell the user, in plain English, which requests are misrouted and
   which actions changed, quote the suggested fix from `agentguard_report`, and propose the smallest edit to the
   Agent Script. After the user applies the fix, run `agentguard_check` again.

## Never
- Never use `--skip-local-tests`, edit `agentguard.policy.yaml`, or delete or weaken cases in `suites/` to get a pass.
- Never submit, publish or promote after BLOCK or ERROR, even if the user insists; explain why and offer the fix.
- Never present a replay (`replayCandidate` / `--replay-candidate`) as a live run.
