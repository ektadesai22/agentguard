# AgentGuard MCP server

Gives AI coding agents (Claude Code, Cursor, VS Code agent mode) the AgentGuard behavioural gate as MCP
tools. Run it next to Copado's own Agentia MCP server (`agentia mcp start`): Agentia drives the user
story, AgentGuard decides whether the agent change is safe to submit.

Agentia plugins cannot register MCP tools yet, so this is a small, separate stdio server over the same
AgentGuard core as the CLI, the Agentia plugin and the local quality gate. Same suite, same policy,
same exit codes.

## Tools

| Tool | What it does |
|---|---|
| `agentguard_check` | Runs the gate: curated suite on the changed agent vs the recorded baseline, policy, plain-English explanation. Returns `PASS` / `WARN` (exit 0), `BLOCK` (2) or `ERROR` (3), the scores, the reasons, the report path and the next step for the agent. |
| `agentguard_report` | Reads the latest report and decision, written by any entry point (this server, the CLI, the plugin or the Copado local quality gate). |
| `agentguard_policy` | Read-only view of what the gate enforces: agent, runner, cases by category, thresholds. |

By design there is **no tool to edit the policy, change the suite or skip the gate**. A BLOCK or ERROR
result tells the agent not to commit, submit or promote. Errors fail closed (ERROR, exit 3), and replays
of saved results are always labelled as replays.

## Build

```bash
cd agentguard        # build the core first
npm ci && npm run build
cd mcp
npm ci && npm run build
npm test             # 7 tests, incl. a real MCP client over stdio
```

## Configure your MCP client

The server uses the folder it is started in as the project (the folder with `agentguard.config.yaml`),
or `AGENTGUARD_PROJECT_DIR` if set. Examples for a project that sits next to this repo:

- Claude Code: [`examples/claude-code.mcp.json`](examples/claude-code.mcp.json) → save as `.mcp.json` in the project root.
- VS Code agent mode: [`examples/vscode.mcp.json`](examples/vscode.mcp.json) → save as `.vscode/mcp.json`.
- Cursor: [`examples/cursor.mcp.json`](examples/cursor.mcp.json) → save as `.cursor/mcp.json`.

The examples are for Windows (`cmd /c agentia …`, because `agentia` is an npm shim). On macOS or Linux use
`"command": "agentia", "args": ["mcp", "start"]`.

Pair it with the Agent Skill ([`../skills/agentguard/SKILL.md`](../skills/agentguard/SKILL.md)) so the agent
knows when to call the gate and what never to do.
