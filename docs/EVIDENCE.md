# AgentGuard — evidence log (live runs, 25–26 Oct 2026)

Every number below comes from a raw Salesforce result file in `runs/live-demo/` (copied from the
Copado pipeline repo `runs/` folder) or from a terminal capture. Offline-demo numbers (synthetic
fixtures) are never used here.

Setup: Agentforce Developer Edition org, agent **Order_Concierge** built in the new Agentforce
Builder (Agent Script, 5 subagents, 6 Apex actions), tested with `sf agent test` and the
**agentforce-studio** runner. Copado Playground, Source Format pipeline, user story **US-0000025**.
AgentGuard runs as Copado's **local quality gate** (`.agentia_quality_gates.cmd`, created by
`agentia setup`). Suite: 24 hand-written cases (8 positive, 10 boundary, 4 safety, 2 off-topic).

| # | Claim | How it was run | Raw evidence | Result | Status |
|---|---|---|---|---|---|
| 1 | Unit and script tests pass | `npm ci && npm run build && npm test` | terminal | 51/51 tests pass (incl. tests on 2 real live result files) | Proven |
| 2 | Offline demo wiring | `node dist/cli.js demo --scenario regressed` / `fixed` | synthetic fixtures | BLOCK exit 2 / PASS exit 0 (labelled synthetic) | Proven |
| 3 | Live test runs with `--test-runner agentforce-studio` | `agentguard check` | `runs/live-demo/*.json` | 24 cases × baseline + candidate per run | Proven |
| 4 | Spec and result format for the new runner | live `sf agent test create/run` | `test/fixtures/studio-live-*.json` | Spec: `name`, `inputs[].utterance`, `scorers[{name, expected}]`; results: Subagent/Action/Response Evaluation, joined by utterance | Proven |
| 5 | Baseline stability (unchanged agent v6) | 4 live runs | `runs/` (Copado repo) | Score 90.8, 97.9, 95.4, 96.7; routing 100% in all 4. One LLM-judge false fail on a safety refusal → safety expectations reworded | Proven |
| 6 | Broken change → BLOCK, exit 2 | regressed agent v8, `agentia cicd work test` | `runs/live-demo/regressed-v8-worktest.json`, `report-regressed-v8-worktest/` | **BLOCK, score 96.7 → 85.1**, routing 100% → 80%, actions 91.7% → 79.2% | Proven |
| 7 | Report names the misroute | as #6 | `report-regressed-v8-worktest/report.md` | "Order Status now catches 100% of Payment Status questions (4 cases)"; wrong action Get_Order_Status instead of Get_Payment_Status; suggested fix | Proven |
| 8 | Safety on the regressed change | as #6 | as #6 | 4/4 safety cases still refused (no safety regression in this change) | Proven |
| 9 | Fix → PASS with the same suite and policy | fixed agent v9, `agentia cicd work test` and `work submit` | `fixed-v9-worktest.json`, `fixed-v9-submit.json` | **PASS (WARN), score 96.7 → 97.1 / 98.3**, routing 100%, safety 100%, exit 0 | Proven |
| 10 | Fail closed: unverifiable run → ERROR exit 3 | first live run on Windows (CLI not found) | terminal capture | ERROR exit 3: "could not verify… treated as blocked", 24 missing cases listed | Proven (live) |
| 11 | Copado local quality gate stops the step | `agentia cicd work test` / `work submit` on US-0000025 | terminal capture | BLOCK → "Local quality gates failed (exit 2)", submit refused; PASS → submitted (promotion a17hm00000kusmdAAA) | Proven |
| 12 | Agentia CLI plugin (`agentia agentguard check`) | — | `plugin/` | Scaffold only; not compiled or linked | Not run |
| 13 | Pre-push hook refuses push on BLOCK/ERROR | unit tests with a fake binary | `test/hook.test.ts` | Refuses on exit 1/2/3 and missing base ref (tested, not live) | Tested |
| 14 | Coding agent follows SKILL.md | — | — | — | Not run |
| 15 | Run duration | timestamps in `runs/` | — | About 1 minute per 24-case live run | Proven |
