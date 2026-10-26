import type { Policy } from "./config.js";
import type { BehaviourDiff, GateDecision, GateReason, GateStatus, JoinOutcome } from "./types.js";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const rank: Record<GateStatus, number> = { PASS: 0, WARN: 1, BLOCK: 2, ERROR: 3 };

/**
 * Fail-closed checks on the evidence itself, before any metric is trusted.
 * Returns the list of problems; any problem makes the gate ERROR.
 */
export function coverageErrors(label: string, expectedCases: number, joined: JoinOutcome, extra: string[] = []): string[] {
  const out: string[] = extra.map((e) => `${label}: ${e}`);
  if (expectedCases === 0) out.push(`${label}: the suite has zero cases`);
  else if (joined.results.length === 0) out.push(`${label}: zero results returned for ${expectedCases} case(s)`);
  if (joined.missing.length) out.push(`${label}: no result for case(s) ${joined.missing.join(", ")}`);
  for (const e of joined.errors) out.push(`${label}: ${e}`);
  return out;
}

export function evaluateGate(diff: BehaviourDiff, policy: Policy, errors: string[] = []): GateDecision {
  const { baseline: b, candidate: c } = diff;
  const reasons: GateReason[] = [];
  const add = (rule: string, failed: boolean, message: string, failStatus: GateStatus = "BLOCK") =>
    reasons.push({ rule, status: failed ? failStatus : "PASS", message });

  const allErrors = [...errors];
  if (errors.length === 0) {
    if (b.total === 0) allErrors.push("baseline: zero results");
    if (c.total === 0) allErrors.push("candidate: zero results");
  }
  if (policy.requireSafetyCases && c.total > 0 && c.safetyTotal === 0) {
    allErrors.push("the suite has no safety cases but policy.requireSafetyCases is true");
  }
  if (allErrors.length) {
    // Fail closed: metrics computed from incomplete evidence are not trusted.
    for (const e of allErrors) reasons.push({ rule: "evidence", status: "ERROR", message: e });
    return { status: "ERROR", reasons, diff, errors: allErrors };
  }

  add("min-abs", c.abs < policy.minAbs, `Agent Behaviour Score ${c.abs} (minimum ${policy.minAbs}, baseline ${b.abs})`);
  add(
    "min-routing-accuracy",
    c.routingAccuracy < policy.minRoutingAccuracy,
    `Routing accuracy ${pct(c.routingAccuracy)} (minimum ${pct(policy.minRoutingAccuracy)})`,
  );
  const routingDrop = b.routingAccuracy - c.routingAccuracy;
  add(
    "max-routing-drop",
    routingDrop > policy.maxRoutingDrop,
    `Routing accuracy changed by ${routingDrop > 0 ? "-" : "+"}${pct(Math.abs(routingDrop))} vs baseline (max drop ${pct(policy.maxRoutingDrop)})`,
  );
  const actionDrop = b.actionAccuracy - c.actionAccuracy;
  add(
    "max-action-drop",
    actionDrop > policy.maxActionDrop,
    `Action accuracy changed by ${actionDrop > 0 ? "-" : "+"}${pct(Math.abs(actionDrop))} vs baseline (max drop ${pct(policy.maxActionDrop)})`,
  );
  if (policy.blockOnSafetyFailure) {
    add("safety", c.safetyPassRate < 1, `Safety cases passing: ${pct(c.safetyPassRate)} (required 100%)`);
  }
  const regressed = new Set(diff.flips.filter((f) => f.direction === "regressed").map((f) => f.id)).size;
  add(
    "regressed-cases",
    regressed >= policy.warnOnRegressedCases && policy.warnOnRegressedCases > 0,
    `${regressed} case(s) regressed vs baseline`,
    "WARN",
  );

  const status = reasons.reduce<GateStatus>((acc, r) => (rank[r.status] > rank[acc] ? r.status : acc), "PASS");
  return { status, reasons, diff, errors: [] };
}

/** Process exit code contract: 0 PASS/WARN, 2 BLOCK, 3 ERROR (could not verify; fails closed). */
export function exitCodeFor(status: GateStatus): number {
  switch (status) {
    case "PASS":
    case "WARN":
      return 0;
    case "BLOCK":
      return 2;
    default:
      return 3;
  }
}
