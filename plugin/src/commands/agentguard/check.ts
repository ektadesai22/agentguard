/**
 * `agentia agentguard check` — the AgentGuard behavioural quality gate as an Agentia CLI plugin.
 *
 * Runs the same pipeline as the `agentguard` CLI (baseline vs candidate on the Agentforce test runner,
 * policy gate, plain-English report) for the active Agentia work item. Uses only the documented host
 * API: work.getWorkItem() for the story label and format.table() for output. It calls no Copado
 * endpoint and receives no credentials. Exit codes: 0 PASS/WARN, 2 BLOCK, 3 ERROR (fail closed).
 */
import {existsSync} from 'node:fs'
import {AgentiaCommand, getAgentiaHost} from '@copado/agentia-plugin-sdk'
import {Flags} from '@oclif/core'
import {check, exitCodeFor, loadConfig, RecordedBaselineRunner, ReplayRunner, SfRunner} from 'agentguard'

const DEFAULT_BASELINE = 'runs/baseline-recorded.json'

export default class AgentguardCheck extends AgentiaCommand {
  static override description =
    'Run the AgentGuard behavioural gate for the active work item: baseline vs candidate, policy, report. Exit 0 PASS/WARN, 2 BLOCK, 3 ERROR.'
  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
    '<%= config.bin %> <%= command.id %> --replay-baseline runs/baseline-recorded.json',
  ]
  static override flags = {
    base: Flags.string({description: 'git ref to diff against, or STAGED', default: 'origin/main'}),
    wait: Flags.integer({description: 'minutes to wait for each sf agent test run', default: 15}),
    'replay-baseline': Flags.string({description: `recorded baseline run (default: ${DEFAULT_BASELINE} when present)`}),
    'replay-candidate': Flags.string({description: 'replay saved candidate results instead of running live'}),
  }

  public async run() {
    const {flags} = await this.parse(AgentguardCheck)
    // Keep this list in sync with "agentia.requires" in package.json.
    const host = getAgentiaHost({requires: ['format.table', 'work.getWorkItem']})

    let workItem: string | undefined
    try {
      const story = await host.work.getWorkItem()
      workItem = (story as {name?: string} | undefined)?.name
    } catch {
      workItem = undefined // no active work item: the gate still runs, only the label is missing
    }

    try {
      const cfg = loadConfig()
      const baselineFile = flags['replay-baseline'] ?? (existsSync(DEFAULT_BASELINE) ? DEFAULT_BASELINE : undefined)
      const live = new SfRunner(cfg, flags.wait)
      const runner =
        baselineFile && flags['replay-candidate']
          ? new ReplayRunner({baseline: baselineFile, candidate: flags['replay-candidate']})
          : baselineFile
            ? new RecordedBaselineRunner(baselineFile, live)
            : live
      const note =
        runner.mode === 'replay'
          ? 'Replay of saved results — not a new live run.'
          : runner.mode === 'recorded-baseline'
            ? `Baseline = recorded run of the unchanged agent (${baselineFile}); candidate run live now.`
            : undefined
      const out = await check(cfg, {base: flags.base, runner, workItem, note})
      const d = out.decision
      const m = (x: number) => `${(x * 100).toFixed(1)}%`

      this.display(() => {
        this.log(`AgentGuard gate: ${d.status}${workItem ? `  (work item ${workItem})` : ''}`)
        if (note) this.log(`Note: ${note}`)
        this.log(
          host.format.table(
            [
              {field: 'metric', header: 'Metric'},
              {field: 'baseline', header: 'Baseline'},
              {field: 'candidate', header: 'Candidate'},
            ],
            [
              {metric: 'Agent Behaviour Score', baseline: String(d.diff.baseline.abs), candidate: String(d.diff.candidate.abs)},
              {metric: 'Routing accuracy', baseline: m(d.diff.baseline.routingAccuracy), candidate: m(d.diff.candidate.routingAccuracy)},
              {metric: 'Action accuracy', baseline: m(d.diff.baseline.actionAccuracy), candidate: m(d.diff.candidate.actionAccuracy)},
              {metric: 'Safety pass rate', baseline: m(d.diff.baseline.safetyPassRate), candidate: m(d.diff.candidate.safetyPassRate)},
            ],
          ),
        )
        for (const line of out.explanation) this.log(`  • ${line}`)
        this.log(`Report: ${out.reportDir}/report.html`)
      })

      process.exitCode = exitCodeFor(d.status)
      return {status: d.status, workItem, mode: out.mode, reasons: d.reasons, baseline: d.diff.baseline, candidate: d.diff.candidate, report: `${out.reportDir}/report.html`}
    } catch (error) {
      // Fail closed: anything unexpected is ERROR (exit 3), never a pass.
      const message = error instanceof Error ? error.message : String(error)
      this.display(() => this.log(`AgentGuard ERROR: ${message}`))
      process.exitCode = 3
      return {status: 'ERROR', workItem, error: message}
    }
  }
}
