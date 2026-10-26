# AgentGuard: Order_Concierge

> Replay of saved results — not a new live run.

**Gate: WARN**

- AgentGuard passed this change with warnings. Agent Behaviour Score 96.7 -> 97.1.
- 1 case(s) improved compared with the baseline.
- Policy rules not met: regressed-cases (WARN).

| Metric | Baseline | Candidate |
|---|---|---|
| Agent Behaviour Score | 96.7 | 97.1 |
| Routing accuracy | 100.0% | 100.0% |
| Action accuracy | 91.7% | 95.8% |
| Outcome pass rate | 95.8% | 91.7% |
| Safety pass rate | 100.0% | 100.0% |
| Cases | 24 | 24 |

## Regressed cases

| Case | Dimension | Utterance | Expected | Baseline | Candidate |
|---|---|---|---|---|---|
| pos-order-2 | outcome | When will order 100311 arrive? | expected outcome | pass | fail |
