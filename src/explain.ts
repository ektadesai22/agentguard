import type { GateDecision } from "./types.js";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const human = (api: string) => api.replace(/_/g, " ");

/**
 * Plain-English explanation of a gate decision, written for the reviewer who approves
 * the promotion (not for the developer who wrote the change). Deterministic, so the same
 * evidence always produces the same report; an LLM can be layered on top for fix suggestions.
 */
export function explain(decision: GateDecision): string[] {
  const { diff } = decision;
  const lines: string[] = [];
  if (decision.status === "ERROR") {
    lines.push("AgentGuard could NOT verify this change (ERROR). It is treated as blocked until a complete run is available.");
    for (const e of decision.errors.slice(0, 8)) lines.push(`Problem: ${e}`);
    if (decision.errors.length > 8) lines.push(`... and ${decision.errors.length - 8} more problem(s); see decision.json.`);
    lines.push("Fix the run (org access, test runner, scorers, suite coverage) and re-run. Do not weaken the policy or delete cases.");
    return lines;
  }
  const verdict =
    decision.status === "BLOCK"
      ? "AgentGuard BLOCKED this promotion."
      : decision.status === "WARN"
        ? "AgentGuard passed this change with warnings."
        : "AgentGuard PASSED this change.";
  lines.push(`${verdict} Agent Behaviour Score ${diff.baseline.abs} -> ${diff.candidate.abs}.`);

  for (const m of diff.newMisroutes.slice(0, 3)) {
    if (m.actualTopic === m.expectedTopic) continue;
    lines.push(
      `"${human(m.actualTopic)}" now catches ${pct(m.share)} of "${human(m.expectedTopic)}" questions (${m.count} case${m.count > 1 ? "s" : ""}).`,
    );
  }

  const unsafe = diff.flips.filter((f) => f.dimension === "safety" && f.direction === "regressed");
  for (const f of unsafe) lines.push(`Safety regression: "${f.utterance}" is no longer handled safely (${f.candidate.replace(/^unsafe: /, "")}).`);

  const wrongAction = diff.flips.filter((f) => f.dimension === "action" && f.direction === "regressed").slice(0, 2);
  for (const f of wrongAction) lines.push(`Wrong action: "${f.utterance}" now runs ${f.candidate} instead of ${f.expected}.`);

  const improved = new Set(diff.flips.filter((f) => f.direction === "improved").map((f) => f.id)).size;
  if (improved) lines.push(`${improved} case(s) improved compared with the baseline.`);

  const failed = decision.reasons.filter((r) => r.status !== "PASS").map((r) => `${r.rule} (${r.status})`);
  if (failed.length) lines.push(`Policy rules not met: ${failed.join(", ")}.`);

  if (decision.status === "BLOCK" && diff.newMisroutes.length) {
    const thief = diff.newMisroutes[0].actualTopic;
    const victims = [...new Set(diff.newMisroutes.filter((m) => m.actualTopic === thief && m.expectedTopic !== thief).map((m) => human(m.expectedTopic)))];
    const q = victims.map((v) => `"${v}"`);
    const list = q.length > 1 ? `${q.slice(0, -1).join(", ")} and ${q[q.length - 1]}` : q[0];
    lines.push(
      `Suggested fix: narrow the scope or description of "${human(thief)}" so it excludes requests that belong to ${list}, and add an explicit instruction to hand those requests to ${list}.`,
    );
  }
  return lines;
}
