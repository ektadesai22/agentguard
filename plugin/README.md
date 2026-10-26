# AgentGuard Agentia CLI plugin

`agentia agentguard check` runs the AgentGuard behavioural gate for the active Agentia work item.
Generated with `npm init @copado/agentia-plugin` (scaffold v0.4.0, SDK `@copado/agentia-plugin-sdk` 0.1.x).

Uses only the documented host API: `work.getWorkItem()` (story label) and `format.table()` (output).
No Copado endpoints are called and no credentials are received. Exit codes: 0 PASS/WARN, 2 BLOCK, 3 ERROR.

```
npm run build --prefix ..      # build the AgentGuard core first
npm install
npm run build
agentia plugins link .
agentia agentguard check                       # live candidate vs runs/baseline-recorded.json (if present)
agentia agentguard check --replay-baseline runs/baseline-recorded.json --replay-candidate <saved-run.json>
```
