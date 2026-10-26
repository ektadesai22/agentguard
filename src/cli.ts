#!/usr/bin/env node
import { Command } from "commander";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, loadConfig } from "./config.js";
import { buildImpact, gitChangedFiles, loadTopics } from "./detect.js";
import { exitCodeFor } from "./gate.js";
import { generateSuite } from "./generate.js";
import { check } from "./pipeline.js";
import { RecordedBaselineRunner, ReplayRunner, SfRunner } from "./runner.js";
import { loadSuite, saveYaml, toSalesforceSpec } from "./suite.js";
import type { GateStatus, ImpactSet } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const paint = (s: GateStatus) =>
  s === "BLOCK" || s === "ERROR" ? `\x1b[41m\x1b[97m ${s} \x1b[0m` : s === "WARN" ? `\x1b[43m\x1b[30m ${s} \x1b[0m` : `\x1b[42m\x1b[30m ${s} \x1b[0m`;
const SYNTHETIC_NOTE = "Replay of synthetic fixtures — not a live run. Numbers are illustrative only.";

const program = new Command()
  .name("agentguard")
  .description("Behavioural quality gates for Agentforce agents (exit codes: 0 PASS/WARN, 2 BLOCK, 3 ERROR)")
  .version("0.1.0");

program
  .command("detect")
  .description("Find changed Agentforce metadata and the topics/actions it can affect")
  .option("--base <ref>", "git ref to diff against, or STAGED", "origin/main")
  .action((o) => {
    const cfg = loadConfig();
    const impact = buildImpact(gitChangedFiles(o.base), cfg.sourceDir);
    console.log(JSON.stringify(impact, null, 2));
  });

program
  .command("generate")
  .description("Build the behavioural suite (golden + generated cases) and the Salesforce test spec")
  .option("--base <ref>", "git ref to diff against, or STAGED", "origin/main")
  .action(async (o) => {
    const cfg = loadConfig();
    const impact = buildImpact(gitChangedFiles(o.base), cfg.sourceDir);
    const suite = await generateSuite(loadSuite(cfg.suiteFile), impact, loadTopics(cfg.sourceDir), cfg);
    const suitePath = join(cfg.workDir, "suite.generated.yaml");
    const specPath = join(cfg.workDir, "spec", `AgentGuard_${cfg.agentApiName}-testSpec.yaml`);
    saveYaml(suitePath, suite);
    saveYaml(specPath, toSalesforceSpec(suite, `AgentGuard_${cfg.agentApiName}`, cfg.spec, cfg.runner));
    console.log(`${suite.cases.length} cases -> ${suitePath}\nSalesforce spec -> ${specPath}`);
  });

program
  .command("check")
  .description("Run baseline vs candidate, diff behaviour and apply the gate policy (fails closed)")
  .option("--base <ref>", "git ref to diff against, or STAGED", "origin/main")
  .option("--work-item <name>", "label for the report, e.g. the active Agentia user story")
  .option("--replay-baseline <file>", "use a saved real run as the baseline (alone: candidate runs live; single-org mode)")
  .option("--replay-candidate <file>", "replay saved candidate results instead of running in an org")
  .option("--wait <minutes>", "minutes to wait for each sf agent test run", "15")
  .option("--json", "print the decision as JSON")
  .action(async (o) => {
    const cfg = loadConfig();
    if (o.replayCandidate && !o.replayBaseline) {
      throw new Error("--replay-candidate needs --replay-baseline");
    }
    const live = new SfRunner(cfg, Number(o.wait));
    const runner = o.replayBaseline && o.replayCandidate
      ? new ReplayRunner({ baseline: o.replayBaseline, candidate: o.replayCandidate })
      : o.replayBaseline
        ? new RecordedBaselineRunner(o.replayBaseline, live)
        : live;
    const note =
      runner.mode === "replay"
        ? "Replay of saved results — not a new live run."
        : runner.mode === "recorded-baseline"
          ? `Baseline = recorded run of the unchanged agent (${o.replayBaseline}); candidate run live now.`
          : undefined;
    const out = await check(cfg, { base: o.base, workItem: o.workItem, runner, note });
    if (o.json) console.log(JSON.stringify({ mode: out.mode, rawFiles: out.rawFiles, ...out.decision }, null, 2));
    else printSummary(out.decision.status, out.explanation, out.reportDir, note);
    process.exitCode = exitCodeFor(out.decision.status);
  });

program
  .command("demo")
  .description("Offline demo on the bundled Order Concierge example: replays SYNTHETIC fixtures (no org needed)")
  .option("--scenario <name>", "regressed | fixed", "regressed")
  .action(async (o) => {
    if (!["regressed", "fixed"].includes(o.scenario)) throw new Error(`unknown scenario "${o.scenario}" (use regressed | fixed)`);
    const ex = join(pkgRoot, "examples", "order-concierge");
    const cfg = { ...loadConfig(ex), workDir: ".agentguard" };
    const impact: ImpactSet = buildImpact(
      [{ path: "force-app/main/default/genAiPlugins/Order_Status.genAiPlugin-meta.xml", status: "M", metadataType: "GenAiPlugin", apiName: "Order_Status" }],
      join(ex, cfg.sourceDir),
    );
    const runner = new ReplayRunner({
      baseline: join(ex, "fixtures", "baseline.json"),
      candidate: join(ex, "fixtures", `candidate-${o.scenario}.json`),
    });
    console.log(`\n[demo] ${SYNTHETIC_NOTE}`);
    const out = await check(cfg, { impact, runner, cwd: ex, workItem: `demo: ${o.scenario}`, note: SYNTHETIC_NOTE });
    printSummary(out.decision.status, out.explanation, out.reportDir, SYNTHETIC_NOTE);
    process.exitCode = exitCodeFor(out.decision.status);
  });

program
  .command("init")
  .description("Add AgentGuard config, policy, golden suite, coding-agent skill and git hook to this repo")
  .option("--hook", "install the git pre-push hook", true)
  .action((o) => {
    const write = (p: string, content: string) => {
      if (existsSync(p)) return console.log(`skip ${p} (exists)`);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
      console.log(`created ${p}`);
    };
    const ex = join(pkgRoot, "examples", "order-concierge");
    write(
      "agentguard.config.yaml",
      readFileSync(join(ex, "agentguard.config.yaml"), "utf8").replace(/^suiteFile: .*$/m, `suiteFile: ${DEFAULT_CONFIG.suiteFile}`),
    );
    write("agentguard.policy.yaml", readFileSync(join(ex, "agentguard.policy.yaml"), "utf8"));
    write(DEFAULT_CONFIG.suiteFile, readFileSync(join(ex, "suites", "golden.yaml"), "utf8"));
    write(".claude/skills/agentguard/SKILL.md", readFileSync(join(pkgRoot, "skills", "agentguard", "SKILL.md"), "utf8"));
    if (o.hook && existsSync(".git")) {
      copyFileSync(join(pkgRoot, "hooks", "pre-push"), ".git/hooks/pre-push");
      chmodSync(".git/hooks/pre-push", 0o755);
      console.log("installed .git/hooks/pre-push");
    }
  });

function printSummary(status: GateStatus, explanation: string[], reportDir: string, note?: string) {
  console.log(`\nAgentGuard gate: ${paint(status)}  (exit ${exitCodeFor(status)})\n`);
  for (const l of explanation) console.log(`  • ${l}`);
  if (note) console.log(`\n  NOTE: ${note}`);
  console.log(`\nReport: ${relative(process.cwd(), join(reportDir, "report.html")) || "report.html"}\n`);
}

program.parseAsync().catch((e) => {
  // Anything unexpected (bad config, invalid suite, git failure) means the change was NOT verified.
  console.error(`agentguard ERROR: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 3;
});
