# AgentGuard — 3-minute demo video script (live run, 25–26 Oct 2026)

All numbers are from the live runs in `runs/live-demo/` (see `docs/EVIDENCE.md`). Record the terminal
in VS Code inside the Copado pipeline repo, plus the Agentforce Builder and the Copado user story.

| Time | Say | Show |
|---|---|---|
| **0:00–0:20** Problem | "Agentforce agents ship through Copado like any metadata. But an agent change can deploy cleanly, pass every Apex test, and still send customers to the wrong place. Nothing in the pipeline checks behaviour. AgentGuard does." | Title card, then the Order Concierge agent in Agentforce Builder (5 subagents). |
| **0:20–0:50** The change | "On user story US-0000025, a developer consolidates payment questions into Order Status: broader description, and the separate payment route removed. It validates, deploys and publishes fine. A reviewer would approve it." | `git diff` of the Agent Script (`agent-variants/Order_Concierge.regressed.agent` vs good). `release-agent.ps1 -Variant regressed` succeeding. |
| **0:50–1:40** BLOCK | "Copado's local quality gate runs AgentGuard. It runs the same 24 cases on the changed agent with Salesforce's Agentforce testing, and compares them with the recorded baseline. BLOCK. Agent Behaviour Score 96.7 to 85.1. Order Status now catches 100% of payment questions — four cases — and runs Get_Order_Status instead of Get_Payment_Status. Routing drops from 100 to 80 percent. It even suggests the fix." | `agentia cicd work test` → red **BLOCK (exit 2)** → "Local quality gates failed (exit 2)". Open `.agentguard/report/report.html`. Then `agentia cicd work submit` → refused. |
| **1:40–2:20** Fix → PASS | "The developer restores the payment route. Same suite, same policy, nothing weakened. AgentGuard passes: score 98.3, routing and safety at 100 percent." | `release-agent.ps1 -Variant good`, commit, `agentia cicd work test` → **PASS**. Show `git diff agentguard.policy.yaml suites/` is empty. |
| **2:20–2:45** Copado | "Now the gate lets it through: work publish registers the commit, work submit validates it in Copado and opens the pull request. And if AgentGuard can't verify a change — a failed run, missing results — it returns ERROR and blocks. It fails closed." | `agentia cicd work publish` and `work submit` → "Submitted… promotion_id…". The Copado user story. The earlier ERROR (exit 3) screenshot. |
| **2:45–3:00** Close | "AgentGuard: behavioural quality gates for Agentforce on Copado Agentia. Baseline versus candidate, fail closed, explained in plain English." | Closing card: repo URL, exit codes (0 PASS/WARN, 2 BLOCK, 3 ERROR). |

## Notes
- Say "safety regression checks for the scenarios we test", not "guarantees safety".
- If you replay saved runs instead of running live, say "replay of the recorded live run" on screen.
