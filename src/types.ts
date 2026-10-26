// Core domain types for AgentGuard.

export type CaseCategory = "positive" | "boundary" | "negative" | "safety";

/** One behavioural test case in an AgentGuard suite (superset of the Salesforce test spec case). */
export interface SuiteCase {
  id: string;
  category: CaseCategory;
  utterance: string;
  expectedTopic: string;
  expectedActions: string[];
  expectedOutcome: string;
  /** Actions that must NEVER be invoked for this utterance (safety cases). */
  forbiddenActions?: string[];
  /** Where the case came from: golden (human-curated) or generated. */
  source?: "golden" | "generated" | "production";
}

export interface Suite {
  name: string;
  agentApiName: string;
  cases: SuiteCase[];
}

/** Metadata change detected in a git diff. */
export interface ChangedFile {
  path: string;
  status: "A" | "M" | "D" | "R";
  metadataType: AgentMetadataType;
  apiName: string;
}

export type AgentMetadataType =
  | "GenAiPlannerBundle"
  | "GenAiPlugin"
  | "GenAiFunction"
  | "GenAiPromptTemplate"
  | "Bot"
  | "BotVersion"
  | "AiAuthoringBundle";

export interface ImpactSet {
  changed: ChangedFile[];
  /** Topic (subagent) API names whose behaviour may change. */
  impactedTopics: string[];
  /** Action API names whose behaviour may change. */
  impactedActions: string[];
  /** True when a planner / bot / authoring bundle changed: test everything. */
  fullRun: boolean;
}

/** Scorer dimensions AgentGuard needs for every case. Latency is informational only. */
export type ScoreDimension = "routing" | "action" | "outcome";

/** Normalised per-case result, independent of the raw Salesforce JSON shape. */
export interface CaseResult {
  utterance: string;
  expectedTopic: string;
  actualTopic: string;
  expectedActions: string[];
  actualActions: string[];
  routingPass: boolean;
  actionPass: boolean;
  outcomePass: boolean;
  outcomeScore?: number;
  latencyMs?: number;
  response?: string;
  /**
   * Problems found while normalising this case (missing scorer, unrecognised result value,
   * case not completed). Any entry makes the gate fail closed with ERROR.
   */
  problems: string[];
}

export interface JoinedResult extends CaseResult {
  id: string;
  category: CaseCategory;
  safetyPass: boolean;
  /** Why a safety case failed (forbidden action, refusal not rated as passing, leak). */
  safetyFindings?: string[];
}

/** Output of joining raw results back to the suite. Never silently drops a case. */
export interface JoinOutcome {
  results: JoinedResult[];
  /** Suite case ids that have no result at all. */
  missing: string[];
  /** Fail-closed problems (missing scorers, unknown values, duplicates, missing safety evidence). */
  errors: string[];
}

export interface SuiteMetrics {
  total: number;
  routingAccuracy: number;
  actionAccuracy: number;
  outcomePassRate: number;
  safetyPassRate: number;
  /** Number of safety cases with a result. */
  safetyTotal: number;
  /** Agent Behaviour Score, 0-100. */
  abs: number;
}

export interface Flip {
  id: string;
  utterance: string;
  category: CaseCategory;
  dimension: "routing" | "action" | "outcome" | "safety";
  direction: "regressed" | "improved";
  expected: string;
  baseline: string;
  candidate: string;
}

export interface Misroute {
  expectedTopic: string;
  actualTopic: string;
  count: number;
  /** Share of the expected topic's cases that went to actualTopic. */
  share: number;
}

export interface BehaviourDiff {
  baseline: SuiteMetrics;
  candidate: SuiteMetrics;
  flips: Flip[];
  /** All routing failures in the candidate run. */
  misroutes: Misroute[];
  /** Routing failures that are NEW compared with the baseline (caused by this change). */
  newMisroutes: Misroute[];
}

/** ERROR = AgentGuard could not verify the change (fails closed: treated as blocking). */
export type GateStatus = "PASS" | "WARN" | "BLOCK" | "ERROR";

export interface GateReason {
  rule: string;
  status: GateStatus;
  message: string;
}

export interface GateDecision {
  status: GateStatus;
  reasons: GateReason[];
  diff: BehaviourDiff;
  /** Fail-closed problems that produced an ERROR status (empty when the run was complete). */
  errors: string[];
}
