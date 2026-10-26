/**
 * The AgentGuard MCP tools as plain functions, so they can be tested without an MCP client.
 *
 * Design rules (same as the CLI, the Agentia plugin and the local quality gate):
 * - Fail closed: anything unexpected is ERROR (exit code 3), never a pass.
 * - Read-only on governance: there is no tool to edit the policy, change the suite or skip the gate.
 * - Honest labels: a replay of saved results is always marked as a replay.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  check,
  exitCodeFor,
  loadConfig,
  loadSuite,
  RecordedBaselineRunner,
  ReplayRunner,
  SfRunner,
  type ImpactSet,
  type Runner,
} from "agentguard";

export const DEFAULT_BASELINE = "runs/baseline-recorded.json";

export interface CheckArgs {
  /** git ref to diff against, or STAGED (default origin/main) */
  base?: string;
  /** recorded baseline run (default runs/baseline-recorded.json when present) */
  replayBaseline?: string;
  /** replay saved candidate results instead of running the agent live */
  replayCandidate?: string;
  /** minutes to wait for each sf agent test run (default 15) */
  waitMinutes?: number;
  /** label for the report, e.g. the Copado user story (US-0000025) */
  workItem?: string;
}

export interface CheckResult {
  status: "PASS" | "WARN" | "BLOCK" | "ERROR";
  exitCode: number;
  mode?: string;
  note?: string;
  workItem?: string;
  scores?: {
    baseline: Record<string, number>;
    candidate: Record<string, number>;
  };
  reasons?: unknown[];
  explanation?: string[];
  report?: string;
  error?: string;
  nextStep: string;
}

const NEXT_STEP: Record<CheckResult["status"], string> = {
  PASS: "Behaviour matches the baseline. The change may be committed, published and submitted through Agentia.",
  WARN: "Within policy, with warnings. The change may be submitted; mention the warnings to the user.",
  BLOCK:
    "Do NOT commit, submit or promote this change. Explain the misrouted requests and changed actions to the user, propose the smallest fix to the Agent Script, then run agentguard_check again. Never weaken the policy or the suite and never use --skip-local-tests.",
  ERROR:
    "AgentGuard could not verify the change, so treat it as blocked. Report the error to the user and fix the cause (org auth, missing results, config). Do not submit.",
};

function pct(x: number): number {
  return Math.round(x * 1000) / 10;
}

function scoreRow(s: { abs: number; routingAccuracy: number; actionAccuracy: number; safetyPassRate: number }) {
  return {
    agentBehaviourScore: s.abs,
    routingAccuracyPct: pct(s.routingAccuracy),
    actionAccuracyPct: pct(s.actionAccuracy),
    safetyPassRatePct: pct(s.safetyPassRate),
  };
}

/** Run the gate. `impact` and `runnerOverride` exist only for tests. */
export async function runCheck(
  projectDir: string,
  args: CheckArgs,
  testHooks: { impact?: ImpactSet; runnerOverride?: Runner } = {},
): Promise<CheckResult> {
  const cwd = resolve(projectDir);
  try {
    const cfg = loadConfig(cwd);
    const abs = (p: string) => resolve(cwd, p);
    const baselineFile = args.replayBaseline
      ? abs(args.replayBaseline)
      : existsSync(join(cwd, DEFAULT_BASELINE))
        ? join(cwd, DEFAULT_BASELINE)
        : undefined;
    if (args.replayCandidate && !baselineFile) throw new Error("replayCandidate needs a baseline (replayBaseline or runs/baseline-recorded.json)");

    const live = new SfRunner(cfg, args.waitMinutes ?? 15, "sf", cwd);
    const runner: Runner =
      testHooks.runnerOverride ??
      (baselineFile && args.replayCandidate
        ? new ReplayRunner({ baseline: baselineFile, candidate: abs(args.replayCandidate) })
        : baselineFile
          ? new RecordedBaselineRunner(baselineFile, live)
          : live);

    const note =
      runner.mode === "replay"
        ? "Replay of saved results, not a new live run."
        : runner.mode === "recorded-baseline"
          ? `Baseline = recorded run of the unchanged agent (${relative(cwd, baselineFile!)}); candidate run live now.`
          : undefined;

    const out = await check(cfg, { base: args.base ?? "origin/main", runner, cwd, workItem: args.workItem, note, impact: testHooks.impact });
    const d = out.decision;
    return {
      status: d.status,
      exitCode: exitCodeFor(d.status),
      mode: out.mode,
      note,
      workItem: args.workItem,
      scores: { baseline: scoreRow(d.diff.baseline), candidate: scoreRow(d.diff.candidate) },
      reasons: d.reasons,
      explanation: out.explanation,
      report: join(relative(cwd, out.reportDir) || ".", "report.md"),
      nextStep: NEXT_STEP[d.status],
    };
  } catch (e) {
    const error = e instanceof Error ? e.message.split("\n")[0] : String(e);
    return { status: "ERROR", exitCode: 3, workItem: args.workItem, error, nextStep: NEXT_STEP.ERROR };
  }
}

/** Plain-text summary for the MCP text content block. */
export function summarise(r: CheckResult): string {
  const lines: string[] = [];
  lines.push(`AgentGuard gate: ${r.status} (exit ${r.exitCode})${r.workItem ? ` for ${r.workItem}` : ""}`);
  if (r.note) lines.push(`Note: ${r.note}`);
  if (r.error) lines.push(`Error: ${r.error}`);
  if (r.scores) {
    const b = r.scores.baseline;
    const c = r.scores.candidate;
    lines.push(`Agent Behaviour Score: ${b.agentBehaviourScore} -> ${c.agentBehaviourScore}`);
    lines.push(`Routing accuracy: ${b.routingAccuracyPct}% -> ${c.routingAccuracyPct}%`);
    lines.push(`Action accuracy: ${b.actionAccuracyPct}% -> ${c.actionAccuracyPct}%`);
    lines.push(`Safety pass rate: ${b.safetyPassRatePct}% -> ${c.safetyPassRatePct}%`);
  }
  for (const l of r.explanation ?? []) lines.push(`- ${l}`);
  if (r.report) lines.push(`Report: ${r.report}`);
  lines.push(`Next step: ${r.nextStep}`);
  return lines.join("\n");
}

/** Read the latest report written by a gate run (from the CLI, the plugin, the quality gate or this server). */
export function readReport(projectDir: string): { found: boolean; text: string; decision?: unknown } {
  const cwd = resolve(projectDir);
  let workDir = ".agentguard";
  try {
    workDir = loadConfig(cwd).workDir;
  } catch {
    /* fall back to the default work dir */
  }
  const dir = join(cwd, workDir, "report");
  const md = join(dir, "report.md");
  if (!existsSync(md)) return { found: false, text: `No AgentGuard report found in ${relative(cwd, dir) || dir}. Run agentguard_check first.` };
  const decisionFile = join(dir, "decision.json");
  const decision = existsSync(decisionFile) ? JSON.parse(readFileSync(decisionFile, "utf8")) : undefined;
  return { found: true, text: readFileSync(md, "utf8"), decision };
}

/** Read-only view of what the gate enforces, so an agent can explain it without editing it. */
export function describePolicy(projectDir: string): { text: string; data?: unknown } {
  const cwd = resolve(projectDir);
  try {
    const cfg = loadConfig(cwd);
    const suite = loadSuite(join(cwd, cfg.suiteFile));
    const byKind: Record<string, number> = {};
    for (const c of suite.cases) {
      byKind[c.category] = (byKind[c.category] ?? 0) + 1;
    }
    const data = {
      agent: cfg.agentApiName,
      runner: cfg.runner,
      baselineOrg: cfg.baselineOrg,
      candidateOrg: cfg.candidateOrg,
      suiteFile: cfg.suiteFile,
      cases: suite.cases.length,
      casesByKind: byKind,
      policy: cfg.policy,
    };
    const text = [
      `Agent: ${data.agent} (runner ${data.runner})`,
      `Suite: ${data.suiteFile}, ${data.cases} cases (${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(", ")})`,
      `Policy: ${JSON.stringify(cfg.policy)}`,
      "These files are governance: an agent must not edit them to get a pass.",
    ].join("\n");
    return { text, data };
  } catch (e) {
    return { text: `ERROR: could not read the AgentGuard config: ${e instanceof Error ? e.message : String(e)}` };
  }
}
