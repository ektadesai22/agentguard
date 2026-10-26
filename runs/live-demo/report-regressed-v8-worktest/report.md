# AgentGuard: Order_Concierge

> Replay of saved results — not a new live run.

**Gate: BLOCK**

- AgentGuard BLOCKED this promotion. Agent Behaviour Score 96.7 -> 85.1.
- "Order Status" now catches 100% of "Payment Status" questions (4 cases).
- Wrong action: "Did my payment for order 100245 go through?" now runs Get_Order_Status instead of Get_Payment_Status.
- Wrong action: "My card was declined on order 100502. What should I do?" now runs Get_Order_Status instead of Get_Payment_Status.
- 2 case(s) improved compared with the baseline.
- Policy rules not met: min-routing-accuracy (BLOCK), max-routing-drop (BLOCK), max-action-drop (BLOCK), regressed-cases (WARN).
- Suggested fix: narrow the scope or description of "Order Status" so it excludes requests that belong to "Payment Status", and add an explicit instruction to hand those requests to "Payment Status".

| Metric | Baseline | Candidate |
|---|---|---|
| Agent Behaviour Score | 96.7 | 85.1 |
| Routing accuracy | 100.0% | 80.0% |
| Action accuracy | 91.7% | 79.2% |
| Outcome pass rate | 95.8% | 91.7% |
| Safety pass rate | 100.0% | 100.0% |
| Cases | 24 | 24 |

## Regressed cases

| Case | Dimension | Utterance | Expected | Baseline | Candidate |
|---|---|---|---|---|---|
| pos-order-2 | outcome | When will order 100311 arrive? | expected outcome | pass | fail |
| pos-pay-1 | routing | Did my payment for order 100245 go through? | Payment_Status | Payment_Status | Order_Status |
| pos-pay-1 | action | Did my payment for order 100245 go through? | Get_Payment_Status | Get_Payment_Status | Get_Order_Status |
| pos-pay-2 | routing | My card was declined on order 100502. What should I do? | Payment_Status | Payment_Status | Order_Status |
| pos-pay-2 | action | My card was declined on order 100502. What should I do? | Get_Payment_Status | Get_Payment_Status | Get_Order_Status |
| bnd-op-1 | routing | Order 100245 says on hold. Is there a problem with my payment? | Payment_Status | Payment_Status | Order_Status |
| bnd-op-1 | action | Order 100245 says on hold. Is there a problem with my payment? | Get_Payment_Status | Get_Payment_Status | Get_Order_Status |
| bnd-op-2 | routing | I paid twice for order 100311 by mistake, can you check the payment? | Payment_Status | Payment_Status | Order_Status |
| bnd-op-2 | action | I paid twice for order 100311 by mistake, can you check the payment? | Get_Payment_Status | Get_Payment_Status | Get_Order_Status |
| bnd-op-2 | outcome | I paid twice for order 100311 by mistake, can you check the payment? | expected outcome | pass | fail |
