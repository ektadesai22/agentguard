---
name: agentguard
description: Behavioural quality gate for Salesforce Agentforce agents delivered through Copado Agentia. Use after changing any agent metadata (Agent Script / aiAuthoringBundles, topics/subagents, actions, prompt templates, planner) and before committing, pushing or submitting an Agentia user story.
---

# AgentGuard — behavioural gate for Agentforce changes

You are working in a Salesforce DX project (Source Format) delivered through Copado with the
Agentia CLI (`agentia`). Agent metadata does not fail like code: a one-line change to a topic
description can silently re-route customer requests or weaken a guardrail. Run AgentGuard
before any agent change leaves the developer's machine.

## When to run

Run when the diff touches any of:
`aiAuthoringBundles/`, `genAiPlugins/`, `genAiFunctions/`, `genAiPromptTemplates/`,
`genAiPlannerBundles/`, `bots/`, `aiTestingDefinitions/`.

## Steps

1. Make sure the user story is the active Agentia work item (`agentia cicd work set ...`).
   Use one local flow per user story; do not mix in cloud commands.
2. Deploy the change to the candidate (developer) org the normal way for this project.
3. Run the gate:
   `agentia agentguard check --base origin/main`
   (fallback if the plugin is not linked: `npx --no-install agentguard check --base origin/main`).
4. Read `.agentguard/report/report.md` and summarise for the developer in plain English:
   gate status, exit code, Agent Behaviour Score baseline -> candidate, each new misroute,
   each safety finding.
5. Act on the result:
   - **PASS / WARN (exit 0)**: tell the developer the gate passed (mention any warnings) and that
     the normal Agentia flow (`commit` -> `push` -> `submit`) and Copado approvals continue.
   - **BLOCK (exit 2)**: the agent's behaviour regressed against the policy. Do NOT commit/push/submit
     to get around it. Propose the smallest metadata edit that fixes the top problem (usually
     narrowing a topic/subagent description or scope, or adding an explicit hand-off
     instruction). Show the diff and wait for approval. After approval: apply, redeploy, re-run step 3.
   - **ERROR (exit 3)**: AgentGuard could not verify the change (run failed, missing results,
     missing scorer, incomplete coverage, no safety cases). Treat it exactly like a block. Report
     the listed problems and fix the cause (org auth, test runner, scorer config, suite). Never
     describe an ERROR as a pass.

## Rules

- Never edit `agentguard.policy.yaml` to make a failing gate pass.
- Never delete, skip or weaken cases in the golden suite to make a gate pass. You may ADD cases.
- Never use `git push --no-verify`, remove the hook, or bypass the Agentia quality gate.
- Every safety case failure is a blocker, whatever the overall score.
- Never claim a result you did not observe. If the org run fails, say so. Replays
  (`--replay-baseline/--replay-candidate`) re-evaluate saved runs; label them as replays, not new runs.
- AgentGuard does not attach anything to the user story. The report stays in
  `.agentguard/report/` and raw runs in `runs/` as evidence.
