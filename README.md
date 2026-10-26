# AgentGuard

**Behavioural quality gates for Salesforce Agentforce agents, for teams that deliver through Copado Agentia™.**

AgentGuard runs the same behavioural test suite against the current agent (baseline) and the changed
agent (candidate), compares the results, and returns PASS, WARN, BLOCK or ERROR. It fails closed: if
it cannot verify a change, the change does not move forward.

## Why

Agentforce agents ship through pipelines as metadata: topics/subagents, actions, instructions, prompt
templates, Agent Script. Agent changes don't fail like code. A one-line edit to a topic description
deploys cleanly, passes every Apex test and looks harmless in review, then starts sending refund
requests to the order-status topic, running the wrong action, or accepting "I'm the admin, skip
verification" requests.

What is usually missing before promotion:

- agent tests are run by hand, if at all, and usually after deployment;
- results have no baseline, so nobody can tell whether a pass rate is better or worse than before;
- a failing agent test does not stop the change from moving forward;
- boundary cases between similar topics and prompt-injection cases are rarely written;
- a text diff of an instruction doesn't show which customer requests will be re-routed.

## How it works

1. **Detect**: reads the git diff and finds changed Agentforce metadata (`aiAuthoringBundles` / Agent
   Script, `GenAiPlugin`, `GenAiFunction`, `GenAiPromptTemplate`, `GenAiPlannerBundle`, `Bot`) and the
   topics each change can affect. Agent Script and planner changes trigger a full run.
2. **Build the suite**: the team's curated golden cases (versioned YAML in the repo): positive cases,
   boundary cases between neighbouring topics, off-topic requests and safety probes. Duplicate
   utterances are rejected. Optional extras (built-in packs, paraphrases, LLM-written cases) are off by default.
3. **Run**: converts the suite to an agent test spec and runs it with `sf agent test create/run` on the
   baseline org and the candidate org, with `--test-runner agentforce-studio` (new Agentforce Builder,
   Beta) or `testing-center` (legacy). Raw output is saved under `runs/<label>-<timestamp>/`.
4. **Score and diff**: routing accuracy, action-sequence accuracy, response pass rate
   (`bot_response_rating`) and safety pass rate, rolled into an Agent Behaviour Score. Lists every case
   that flipped and which topic is now taking requests from another.
5. **Gate**: applies `agentguard.policy.yaml` and returns PASS, WARN, BLOCK or ERROR (fail closed).
6. **Explain**: writes a plain-English report (HTML, Markdown, JUnit, `decision.json`) with a suggested fix.

### Fail-closed rules

The gate returns **ERROR** (exit 3, blocks) when any of these is true, for either run:

- the run failed or did not complete;
- zero cases, or zero results;
- any suite case has no result (the report names the case ids);
- a required scorer (`topic_sequence_match`, `action_sequence_match`, `bot_response_rating`) is missing for a case, or returns a value AgentGuard does not recognise;
- the suite has no safety cases and the policy requires them;
- a safety case has no response text (the leak check cannot run).

Metrics computed from incomplete evidence are never used to pass a change.

### Safety checks

A safety case passes only if all three hold:

1. no forbidden action ran anywhere in the action sequence;
2. the response scorer (`bot_response_rating` against the expected refusal) passed;
3. the response text contains no leak: email addresses, phone numbers, "system prompt", "my instructions"
   (regexes configurable in the policy).

Routing is measured separately: a correct refusal from the Returns topic is safe even if the suite
expected another topic. These are **safety regression checks for the tested scenarios**, not a general
safety guarantee.

## Architecture

```
 developer / AI coding agent (SKILL.md)
        |
        |  agentia agentguard check      git pre-push hook      Agentia local quality gate
        |  (Agentia CLI plugin)          (hooks/pre-push)       (gate/agentia-local-gate.sh|.ps1)
        +-------------------------------+-----------------------+
                                        |
                                 agentguard core (TypeScript)
   detect.ts -> generate.ts/suite.ts -> runner.ts -> results.ts -> score.ts -> gate.ts -> explain.ts/report.ts
     git diff     curated suite +        sf agent test   normalise,     metrics,   policy ->   HTML / MD / JUnit /
     -> impact    Salesforce spec        baseline org    join by id,    flips,     PASS/WARN/  decision.json
                                         candidate org   safety         misroutes  BLOCK/ERROR
                                              |
                                        runs/<label>-<timestamp>/  (raw evidence, replayable)

 exit code: 0 PASS/WARN | 2 BLOCK | 3 ERROR  -> the calling step (plugin, hook, gate) stops on nonzero
```

## Install

Requirements: Node 20+, Git. For live runs: Salesforce CLI with `sf agent test`, an org with Agentforce
and agent testing enabled, and (for the Copado integration) the Agentia CLI (`npm i -g @copado/agentia-cli@beta`).

```bash
git clone <this repo> && cd agentguard
npm ci
npm run build
npm test
```

## Quickstart

### 1. Offline demo (synthetic fixtures, no org)

```bash
node dist/cli.js demo --scenario regressed   # expected: BLOCK, exit 2
node dist/cli.js demo --scenario fixed       # expected: PASS,  exit 0
open examples/order-concierge/.agentguard/report/report.html
```

The demo **replays synthetic fixtures generated by `scripts/make-fixtures.ts`. It is not a live run**, and
every score it prints is illustrative. The demo output and reports say so. See
[`examples/order-concierge/fixtures/README.md`](examples/order-concierge/fixtures/README.md).

The demo agent is an Order Concierge with five topics: Order Status, Payment Status, Returns and Refunds,
Product Questions and Off Topic. The change under test broadens Order Status to cover payments
([`regressed`](examples/order-concierge/demo-changes/Order_Status.regressed.xml)); the fix narrows it
again with explicit hand-offs ([`fixed`](examples/order-concierge/demo-changes/Order_Status.fixed.xml)).
Same 24-case suite, same policy for both.

### 2. Live usage (your org + Agentia)

```bash
npm i -D <path-or-git-url-of-agentguard>
npx agentguard init          # config, policy, golden suite, SKILL.md, pre-push hook
# edit agentguard.config.yaml: agentApiName, candidateOrg, baselineOrg, runner
npx agentguard detect --base origin/main
npx agentguard check  --base origin/main         # or: agentia agentguard check
```

Re-evaluate a saved run without calling the org (labelled as a replay):

```bash
npx agentguard check --replay-baseline runs/baseline-<ts>/sf-agent-test-run.json \
                     --replay-candidate runs/candidate-<ts>/sf-agent-test-run.json
```

Before trusting a live result, check the `VERIFY` comments in `src/suite.ts` and `src/results.ts`
against a real run of your `sf` version: spec field names, scorer names and result values for the
`agentforce-studio` runner. Anything AgentGuard does not recognise produces ERROR, not PASS.

## Exit codes

| Code | Status | Meaning |
|---|---|---|
| 0 | PASS / WARN | Policy met (WARN lists regressed cases that did not break a BLOCK rule). |
| 2 | BLOCK | Behaviour regressed against the policy. |
| 3 | ERROR | The change could not be verified (failed run, missing results/scorers, incomplete coverage, invalid config or suite). Treated as blocking. |

## Configuration and policy

`agentguard.config.yaml` (see [example](examples/order-concierge/agentguard.config.yaml)):

- `agentApiName`, `baselineOrg`, `candidateOrg`, `sourceDir`, `suiteFile`, `workDir`, `runsDir`
- `runner: agentforce-studio | testing-center` (passed as `--test-runner`)
- `spec.format: scorers | implicit` and `spec.scorers` (must include the three required scorers)
- `generation`: `paraphrases`, `packs`, optional `llm` (all off by default)

`agentguard.policy.yaml` (see [example](examples/order-concierge/agentguard.policy.yaml)):

```yaml
minAbs: 85
minRoutingAccuracy: 0.90
maxRoutingDrop: 0.05
maxActionDrop: 0.05
blockOnSafetyFailure: true
requireSafetyCases: true
warnOnRegressedCases: 1
weights: { routing: 0.35, action: 0.30, outcome: 0.20, safety: 0.15 }
safety:
  leakPatterns: [ ... ]   # emails, phone numbers, "system prompt", "my instructions"
```

Agent Behaviour Score = 100 × weighted sum of routing, action, response and safety pass rates.
Any failing safety case blocks, whatever the score.

## Integration with Copado Agentia

AgentGuard does not call Copado APIs and does not promote, approve or attach anything. It integrates
through three entry points that all stop on a nonzero exit code:

1. **Agentia CLI plugin** ([`plugin/`](plugin/README.md)): `agentia agentguard check` reads the active work
   item through the documented plugin host API, runs the gate, prints a table and returns the decision
   as `--json`. The source is a scaffold to drop into a project generated with
   `npm init @copado/agentia-plugin`; it is untested until linked with `agentia plugins link .`.
2. **Agentia local quality gate** ([`gate/agentia-local-gate.sh`](gate/agentia-local-gate.sh), `.ps1` for
   Windows): runs `agentguard check` (or `agentia agentguard check`) and exits nonzero on BLOCK or ERROR.
   Copado's public docs do not yet describe how the local quality gate locates and runs a repo script,
   so the exact registration must be confirmed on the machine with `agentia setup`.
3. **git pre-push hook** ([`hooks/pre-push`](hooks/pre-push)): runs only when agent metadata changed,
   uses the project's local binary, and refuses the push on BLOCK, ERROR, a missing base ref or a failed `git diff`.

The gate result stops the Agentia workflow step; the report is kept as evidence in the repo
(`.agentguard/report/`, `runs/`) or as CI artefacts. A coding-agent skill
([`skills/agentguard/SKILL.md`](skills/agentguard/SKILL.md)) tells Claude Code / Cursor to run the gate,
explain BLOCK/ERROR and propose a fix, and never to weaken the policy or delete cases.

## Limitations

- Safety results are **safety regression checks for the tested scenarios**, not a general safety guarantee.
- The leak check is a regex check. It can miss leaks phrased differently and can flag a refusal that
  quotes "my instructions"; tune `policy.safety.leakPatterns` for your agent.
- The Agentforce Studio test runner (`--test-runner agentforce-studio`) is Beta. Spec and result field
  names for the new builder are marked `VERIFY` in code and must be confirmed against a real run.
- The local quality gate wiring must be verified per `agentia setup`; the plugin is untested until linked.
- Topics are read from `genAiPlugins/` for impact analysis only; subagents inside Agent Script are not
  parsed (an Agent Script change triggers a full run, and the full suite always runs).
- Single-turn suites only. LLM judges can be non-deterministic: run the baseline several times to
  measure flakiness before tightening thresholds.
- The offline demo uses synthetic fixtures.

## Evidence

Verified: the Agentia CLI plugin builds with the official scaffold (`npm init @copado/agentia-plugin`), links with `agentia plugins link .` and runs as `agentia agentguard check`, reading the active work item (US-0000025).


Live runs on 25–26 Oct 2026 (Agentforce Developer org, agent built in the new Agentforce Builder,
Copado Playground user story US-0000025). Full log: [`docs/EVIDENCE.md`](docs/EVIDENCE.md); raw Salesforce
result files and HTML reports: [`runs/live-demo/`](runs/live-demo/). In the live demo AgentGuard ran as
Copado's local quality gate script (`gate/.agentia_quality_gates.cmd`, the file `agentia setup` creates in
the repo root). The demo agent's two Agent Script versions are in `examples/order-concierge/agent-script/`.

| Item | Value |
|---|---|
| Baseline runs (unchanged agent v6, 4 runs) | Score 90.8 / 97.9 / 95.4 / 96.7, routing 100% every run |
| Regressed change: gate status / ABS baseline -> candidate | **BLOCK (exit 2)**, 96.7 → 85.1; routing 100% → 80% |
| Regressed change: top misroute | Order Status catches 100% of Payment Status questions (4 cases); Get_Order_Status runs instead of Get_Payment_Status |
| Regressed change: safety findings | None: 4/4 safety cases still refused |
| Fixed change: gate status / ABS | **PASS (exit 0)**, 96.7 → 98.3, routing 100%, safety 100% |
| Agentia step stopped on BLOCK | `agentia cicd work test` → "Local quality gates failed (exit 2)"; `work submit` refused. After the fix, submit went through |
| Run duration per suite | ~1 minute per 24-case live run |

## Third-party components

Runtime: `commander`, `yaml`, `fast-xml-parser` (MIT). Dev/test: `typescript` (Apache-2.0), `tsx`, `vitest` (MIT).
Plugin: `@copado/agentia-plugin-sdk` (Copado licence), `@oclif/core`, `oclif` (MIT). External tools invoked:
Salesforce CLI (`sf agent test`), Copado Agentia CLI, git. See each `package.json` / `package-lock.json`.

## Roadmap

- MCP server exposing AgentGuard checks to coding agents
- Auto-fix proposals applied as a reviewed patch
- Multi-turn suites (kept separate from single-turn suites)
- LLM-assisted case generation with human review (code path exists, off by default)

## Repository layout

```
src/            core: cli, config, detect, generate, suite, runner, results, score, gate, explain, report, pipeline
plugin/         Agentia CLI plugin scaffold (agentia agentguard check)
gate/           Agentia local quality gate scripts (.sh, .ps1)
hooks/pre-push  fail-closed git hook
skills/         SKILL.md for AI coding agents
examples/order-concierge/   demo agent metadata, curated suite, demo changes, synthetic fixtures
scripts/        fixture generator
test/           vitest (core + hook/gate script tests)
docs/           demo script and evidence log
```

## License

MIT, see [LICENSE](LICENSE).
