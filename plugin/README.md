# AgentGuard Agentia plugin (source scaffold)

This folder holds the source for an Agentia CLI plugin that exposes AgentGuard as
`agentia agentguard check`.

**Status: untested until linked.** It is excluded from the root `tsconfig.json` and the root
test run, and it will not compile in this repository on its own because it depends on the
Agentia plugin SDK.

## How it was made / how to build it

1. Generate the official scaffold (this pulls the correct SDK version and build setup):
   ```bash
   npm init @copado/agentia-plugin plugin
   ```
2. Replace the generated command files with the files in this folder
   (`src/commands/agentguard/check.ts`), and merge the `agentia` and `oclif` sections of
   `package.json`. Keep the SDK version the generator wrote (replace the
   `REPLACE_WITH_VERSION_FROM_GENERATOR` placeholder).
3. Build and link:
   ```bash
   npm install
   npm run build
   agentia plugins link .
   agentia agentguard check --help
   ```

Lines marked `VERIFY` in `check.ts` are assumptions about the SDK surface (flag helpers, the
shape returned by `work.getWorkItem()`, the `format.table` argument format) that must be
checked against the generated scaffold.

## What it does

- Reads the active work item with `getAgentiaHost().work.getWorkItem()` (used only as a report label).
- Runs the AgentGuard pipeline from the core package (`agentguard`): detect, build suite, run
  baseline and candidate with `sf agent test`, score, gate, explain.
- Prints the gate rules with `host.format.table`.
- Returns the decision as the `--json` output.
- Sets the process exit code: 0 PASS/WARN, 2 BLOCK, 3 ERROR.

## What it does not do

The plugin host API does not support calling Copado endpoints, receiving credentials, wrapping
existing commands or registering MCP tools, and no documented command attaches files to a user
story. So the plugin does **not** attach reports to user stories. The gate result stops the
Agentia workflow step through the exit code; the report is kept as evidence in the repo
(`.agentguard/report/`, raw runs in `runs/`) or as CI artefacts.

Declared host capabilities (`package.json`):

```json
"agentia": { "hostApi": 1, "requires": ["work.getWorkItem", "format.table"] }
```
