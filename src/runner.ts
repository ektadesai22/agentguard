import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentGuardConfig } from "./config.js";
import { normaliseResults, runProblems } from "./results.js";
import { saveYaml, toSalesforceSpec } from "./suite.js";
import type { CaseResult, Suite } from "./types.js";

export interface RunOutput {
  results: CaseResult[];
  /** Run-level problems (run not completed, malformed file). Any entry makes the gate ERROR. */
  problems: string[];
  /** Where the raw output was saved / read from (evidence). */
  rawPath?: string;
}

export interface Runner {
  /** "live" = executed in an org now; "replay" = saved results read from disk. */
  readonly mode: "live" | "replay" | "recorded-baseline";
  run(suite: Suite, org: string, label: "baseline" | "candidate"): Promise<RunOutput>;
}


/**
 * Run the Salesforce CLI. On Windows `sf` is a `sf.cmd` shim, which Node can only start through a
 * shell; arguments are quoted because paths often contain spaces (e.g. "OneDrive - Company").
 */
export function quoteWinArg(a: string): string {
  return /[\s"&|<>^()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}
function runSf(sf: string, args: string[], opts: Parameters<typeof execFileSync>[2]): string {
  if (process.platform === "win32") {
    return String(execSync([sf, ...args.map(quoteWinArg)].join(" "), opts as Parameters<typeof execSync>[1]));
  }
  return String(execFileSync(sf, args, opts));
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

/**
 * Runs the suite through the Salesforce CLI:
 *   sf agent test create --spec <file> --api-name <test> --test-runner <runner> --target-org <org> --force-overwrite --json
 *   sf agent test run --api-name <test> --test-runner <runner> --target-org <org> --wait <min>
 *                     --result-format json --output-dir <runsDir>/<label>-<timestamp> --json
 * `runner: agentforce-studio` (Beta) is for agents built in the new Agentforce Builder;
 * `runner: testing-center` is for legacy agents.
 * Raw stdout is also saved in the run directory (runsDir, default `runs/`, meant to be kept as
 * evidence) so any run can be replayed and audited.
 *
 * VERIFY AGAINST A REAL RUN: flag names on your installed `sf` version (`sf agent test run --help`)
 * and which files `--output-dir` writes for the agentforce-studio runner.
 */
export class SfRunner implements Runner {
  readonly mode = "live" as const;
  constructor(private cfg: AgentGuardConfig, private waitMinutes = 15, private sf = "sf", private cwd = process.cwd()) {}

  async run(suite: Suite, org: string, label: "baseline" | "candidate"): Promise<RunOutput> {
    const testName = `AgentGuard_${suite.agentApiName}`;
    const runDir = join(this.cwd, this.cfg.runsDir, `${label}-${stamp()}`);
    mkdirSync(runDir, { recursive: true });
    const specPath = join(this.cwd, this.cfg.workDir, "spec", `${testName}-testSpec.yaml`);
    saveYaml(specPath, toSalesforceSpec(suite, testName, this.cfg.spec, this.cfg.runner));
    const runnerFlag = ["--test-runner", this.cfg.runner];

    runSf(
      this.sf,
      ["agent", "test", "create", "--spec", specPath, "--api-name", testName, ...runnerFlag, "--target-org", org, "--force-overwrite", "--json"],
      { cwd: this.cwd, stdio: ["ignore", "pipe", "inherit"] },
    );
    let out = "";
    try {
      out = runSf(
      this.sf,
      [
        "agent", "test", "run",
        "--api-name", testName,
        ...runnerFlag,
        "--target-org", org,
        "--wait", String(this.waitMinutes),
        "--result-format", "json",
        "--output-dir", runDir,
        "--json",
      ],
      { cwd: this.cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      );
    } catch (e) {
      // `sf agent test run` can exit non-zero when test cases fail. If it still wrote the result
      // file, evaluate it (failing cases are AgentGuard's job); otherwise the run really failed.
      out = String((e as { stdout?: unknown }).stdout ?? "");
      if (!readdirSync(runDir).some((f) => /^test-result-.*\.json$/.test(f))) throw e;
    }
    writeFileSync(join(runDir, "sf-agent-test-run.json"), out);
    // `--output-dir` writes test-result-<jobId>.json (the full per-case result, verified for the
    // agentforce-studio runner). Prefer it; fall back to the command's stdout.
    const resultFile = readdirSync(runDir).find((f) => /^test-result-.*\.json$/.test(f));
    const rawPath = resultFile ? join(runDir, resultFile) : join(runDir, "sf-agent-test-run.json");
    const raw = JSON.parse(readFileSync(rawPath, "utf8"));
    return { results: normaliseResults(raw), problems: runProblems(raw), rawPath };
  }
}

/**
 * Replays saved raw results. Used for the offline demo (synthetic fixtures), unit tests and
 * re-evaluating a previous live run. Output is labelled "replay" in every report.
 */
export class ReplayRunner implements Runner {
  readonly mode = "replay" as const;
  constructor(private files: { baseline: string; candidate: string }) {}

  async run(_suite: Suite, _org: string, label: "baseline" | "candidate"): Promise<RunOutput> {
    const file = this.files[label];
    if (!existsSync(file)) throw new Error(`Replay file not found: ${file}`);
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return { results: normaliseResults(raw), problems: runProblems(raw), rawPath: file };
  }
}

/**
 * Single-org mode: the baseline is a saved raw result of a real earlier run of the unchanged
 * agent (e.g. runs/baseline-<timestamp>/sf-agent-test-run.json); the candidate runs live now.
 * Use when only one Agentforce org is available. Reports label the baseline as recorded.
 */
export class RecordedBaselineRunner implements Runner {
  readonly mode = "recorded-baseline" as const;
  constructor(private baselineFile: string, private live: Runner) {}

  async run(suite: Suite, org: string, label: "baseline" | "candidate"): Promise<RunOutput> {
    if (label === "candidate") return this.live.run(suite, org, label);
    if (!existsSync(this.baselineFile)) throw new Error(`Recorded baseline not found: ${this.baselineFile}`);
    const raw = JSON.parse(readFileSync(this.baselineFile, "utf8"));
    return { results: normaliseResults(raw), problems: runProblems(raw), rawPath: this.baselineFile };
  }
}
