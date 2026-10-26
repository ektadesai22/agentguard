/**
 * `agentia agentguard check`: runs the AgentGuard behavioural gate for the active Agentia work item.
 *
 * UNTESTED until generated with the official scaffold and linked (`agentia plugins link .`).
 * Uses only the documented plugin host API: getAgentiaHost(), host.work.getWorkItem(),
 * host.format.table(). It does not call Copado endpoints, receive credentials or wrap other
 * commands. The gate result reaches the Agentia workflow through the exit code; the report
 * files stay in the repo (.agentguard/report/) and raw runs in runs/ as evidence.
 */
import { AgentiaCommand, getAgentiaHost } from "@copado/agentia-plugin-sdk";
// Flags come from oclif. VERIFY: the scaffold may re-export Flags from the SDK instead.
import { Flags } from "@oclif/core";
import { check, exitCodeFor, loadConfig, ReplayRunner, SfRunner } from "agentguard";
import type { GateDecision } from "agentguard";

export default class AgentguardCheck extends AgentiaCommand {
  static summary = "Run the AgentGuard behavioural gate (baseline vs candidate) for the active work item.";
  static description =
    "Exit codes: 0 PASS/WARN, 2 BLOCK, 3 ERROR (could not verify; fails closed). Reports are written to .agentguard/report/.";

  static flags = {
    base: Flags.string({ description: "git ref to diff against, or STAGED", default: "origin/main" }),
    wait: Flags.integer({ description: "minutes to wait for each sf agent test run", default: 15 }),
    "replay-baseline": Flags.string({ description: "replay saved baseline results instead of running in an org" }),
    "replay-candidate": Flags.string({ description: "replay saved candidate results instead of running in an org" }),
  };

  async run(): Promise<GateDecision & { workItem?: string; mode: string }> {
    // VERIFY: AgentiaCommand may expose parsed flags differently; this is the standard oclif call.
    const { flags } = await this.parse(AgentguardCheck);
    const host = getAgentiaHost();

    let workItem: string | undefined;
    try {
      // VERIFY the shape returned by work.getWorkItem() (name / id fields).
      const wi = (await host.work.getWorkItem()) as { name?: string; id?: string; title?: string } | undefined;
      workItem = wi?.name ?? wi?.title ?? wi?.id;
    } catch {
      workItem = undefined; // No active work item: the gate still runs; the label is just missing.
    }

    let decision: GateDecision;
    let mode = "live";
    try {
      const cfg = loadConfig();
      const replay = flags["replay-baseline"] && flags["replay-candidate"];
      const runner = replay
        ? new ReplayRunner({ baseline: flags["replay-baseline"]!, candidate: flags["replay-candidate"]! })
        : new SfRunner(cfg, flags.wait);
      mode = runner.mode;
      const out = await check(cfg, { base: flags.base, runner, workItem });
      decision = out.decision;

      this.display(() => {
        this.log(`AgentGuard gate: ${decision.status}${workItem ? ` (${workItem})` : ""}${mode === "replay" ? " [replay, not a new live run]" : ""}`);
        // VERIFY the column/row format expected by host.format.table.
        const table = host.format.table(
          ["Rule", "Result", "Detail"],
          decision.reasons.map((r) => [r.rule, r.status, r.message]),
        );
        if (typeof table === "string") this.log(table);
        for (const line of out.explanation) this.log(`- ${line}`);
        this.log(`Report: ${out.reportDir}/report.html`);
      });
    } catch (e) {
      // Fail closed: any unexpected error is an ERROR (exit 3), never a pass.
      this.log(`AgentGuard ERROR: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 3;
      return { status: "ERROR", reasons: [], errors: [String(e)], diff: undefined as never, workItem, mode };
    }

    process.exitCode = exitCodeFor(decision.status);
    return { ...decision, workItem, mode }; // returned value is the --json output
  }
}
