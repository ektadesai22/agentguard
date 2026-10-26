import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentGuardConfig } from "./config.js";
import { buildImpact, gitChangedFiles, loadTopics } from "./detect.js";
import { explain } from "./explain.js";
import { coverageErrors, evaluateGate } from "./gate.js";
import { generateSuite } from "./generate.js";
import { toHtml, toJUnit, toMarkdown } from "./report.js";
import { joinResults } from "./results.js";
import type { RunOutput, Runner } from "./runner.js";
import { diffResults } from "./score.js";
import { loadSuite, saveYaml } from "./suite.js";
import type { GateDecision, ImpactSet, Suite } from "./types.js";

export interface CheckOptions {
  base?: string;
  impact?: ImpactSet;
  runner: Runner;
  cwd?: string;
  /** Optional label for the report, e.g. the active Agentia work item / user story name. */
  workItem?: string;
  /** Banner shown in every report and in decision.json (e.g. "replay of synthetic fixtures"). */
  note?: string;
}

export interface CheckOutput {
  decision: GateDecision;
  impact: ImpactSet;
  reportDir: string;
  explanation: string[];
  mode: Runner["mode"];
  rawFiles: { baseline?: string; candidate?: string };
}

async function safeRun(runner: Runner, suite: Suite, org: string, label: "baseline" | "candidate"): Promise<RunOutput> {
  try {
    return await runner.run(suite, org, label);
  } catch (e) {
    // A failed run is evidence of nothing: record it and let the gate fail closed (ERROR).
    return { results: [], problems: [`run failed: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`] };
  }
}

/**
 * End-to-end gate: detect -> build suite -> run baseline & candidate -> score & diff -> gate -> explain.
 * The decision and all reports are written BEFORE anything optional happens, so the evidence
 * always exists and the exit code always reflects the decision. AgentGuard does not call Copado:
 * integration is the Agentia plugin / local quality gate script, which stop the workflow step
 * on a nonzero exit code.
 */
export async function check(cfg: AgentGuardConfig, opts: CheckOptions): Promise<CheckOutput> {
  const cwd = opts.cwd ?? process.cwd();
  const sourceDir = join(cwd, cfg.sourceDir);
  const impact = opts.impact ?? buildImpact(gitChangedFiles(opts.base ?? "origin/main", cwd), sourceDir);
  const golden = loadSuite(join(cwd, cfg.suiteFile));
  const suite = await generateSuite(golden, impact, loadTopics(sourceDir), cfg);

  const reportDir = join(cwd, cfg.workDir, "report");
  mkdirSync(reportDir, { recursive: true });
  saveYaml(join(cwd, cfg.workDir, "suite.generated.yaml"), suite);

  const baseRun = await safeRun(opts.runner, suite, cfg.baselineOrg, "baseline");
  const candRun = await safeRun(opts.runner, suite, cfg.candidateOrg, "candidate");
  const leak = cfg.policy.safety?.leakPatterns;
  const baseJoin = joinResults(suite, baseRun.results, leak);
  const candJoin = joinResults(suite, candRun.results, leak);
  const errors = [
    ...coverageErrors("baseline", suite.cases.length, baseJoin, baseRun.problems),
    ...coverageErrors("candidate", suite.cases.length, candJoin, candRun.problems),
  ];
  const decision = evaluateGate(diffResults(baseJoin.results, candJoin.results, cfg.policy.weights), cfg.policy, errors);
  const explanation = explain(decision);

  const title = `AgentGuard: ${cfg.agentApiName}${opts.workItem ? ` (${opts.workItem})` : ""}`;
  const rawFiles = { baseline: baseRun.rawPath, candidate: candRun.rawPath };
  writeFileSync(
    join(reportDir, "decision.json"),
    JSON.stringify(
      { mode: opts.runner.mode, note: opts.note, workItem: opts.workItem, runner: cfg.runner, rawFiles, impact, decision, generatedAt: new Date().toISOString() },
      null,
      2,
    ),
  );
  writeFileSync(join(reportDir, "report.md"), toMarkdown(decision, title, opts.note));
  writeFileSync(join(reportDir, "report.html"), toHtml(decision, title, opts.note));
  writeFileSync(join(reportDir, "junit.xml"), toJUnit(decision));

  // Optional steps (none built in) must go below this line and must not change the decision.
  return { decision, impact, reportDir, explanation, mode: opts.runner.mode, rawFiles };
}
