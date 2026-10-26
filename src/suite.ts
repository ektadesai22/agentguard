import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import YAML from "yaml";
import type { AgentGuardConfig } from "./config.js";
import type { Suite, SuiteCase } from "./types.js";

const CATEGORIES = new Set(["positive", "boundary", "negative", "safety"]);
export const normaliseUtterance = (u: string) => u.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Validate a suite. Results are re-joined to cases by utterance, so duplicate utterances
 * would collide and silently hide a case: they are rejected here (finding 11).
 */
export function validateSuite(suite: Suite, source = "suite"): Suite {
  const errors: string[] = [];
  if (!suite || !Array.isArray(suite.cases)) throw new Error(`${source}: missing "cases" list`);
  const byUtterance = new Map<string, string>();
  const ids = new Set<string>();
  for (const c of suite.cases) {
    if (!c.utterance || typeof c.utterance !== "string") errors.push(`case ${c.id}: utterance is required`);
    else {
      const key = normaliseUtterance(c.utterance);
      const prev = byUtterance.get(key);
      if (prev) errors.push(`duplicate utterance in cases ${prev} and ${c.id}: "${c.utterance}"`);
      else byUtterance.set(key, c.id);
    }
    if (ids.has(c.id)) errors.push(`duplicate case id: ${c.id}`);
    ids.add(c.id);
    if (!CATEGORIES.has(c.category)) errors.push(`case ${c.id}: unknown category "${c.category}"`);
    if (!c.expectedTopic) errors.push(`case ${c.id}: expectedTopic is required`);
    if (!c.expectedOutcome) errors.push(`case ${c.id}: expectedOutcome is required (bot_response_rating needs it)`);
  }
  if (errors.length) throw new Error(`${source} is invalid:\n  - ${errors.join("\n  - ")}`);
  return suite;
}

export function loadSuite(path: string): Suite {
  const raw = YAML.parse(readFileSync(path, "utf8")) as Suite;
  if (!raw || !Array.isArray(raw.cases)) throw new Error(`${path}: missing "cases" list`);
  raw.cases = raw.cases.map((c, i) => ({
    ...c,
    id: c.id ?? `case-${i + 1}`,
    expectedActions: c.expectedActions ?? [],
    forbiddenActions: c.forbiddenActions ?? [],
    source: c.source ?? "golden",
  }));
  return validateSuite(raw, path);
}

export function saveYaml(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, YAML.stringify(data, { lineWidth: 120 }));
}

/** Merge cases, de-duplicating by normalised utterance (first one wins, so golden cases win over generated ones). */
export function mergeCases(...lists: SuiteCase[][]): SuiteCase[] {
  const seen = new Set<string>();
  const out: SuiteCase[] = [];
  for (const list of lists) {
    for (const c of list) {
      const key = normaliseUtterance(c.utterance);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

const ASSERTION_SCORERS = ["topic_sequence_match", "action_sequence_match", "bot_response_rating"];

/**
 * Convert an AgentGuard suite to the Salesforce agent test spec
 * (the YAML consumed by `sf agent test create --spec`).
 * AgentGuard-only fields (id, category, forbiddenActions) stay in the suite file
 * and are re-joined to results by utterance (utterances are unique, see validateSuite).
 *
 * VERIFY AGAINST A REAL RUN: the spec field names below (`testCases`, `expectedTopic`,
 * `expectedActions`, `expectedOutcome`, `metrics`) are the Agentforce DX spec shape. For the
 * new Agentforce Builder (`--test-runner agentforce-studio`, AiTestingDefinition with
 * `<scorer>` tags) confirm that `metrics` maps to scorers and that topic routing is
 * asserted on subagents. Switch `spec.format` in agentguard.config.yaml if needed.
 */
export function toSalesforceSpec(
  suite: Suite,
  testName: string,
  spec: AgentGuardConfig["spec"] = { format: "scorers", scorers: [...ASSERTION_SCORERS, "output_latency_milliseconds"] },
  runner: AgentGuardConfig["runner"] = "testing-center",
) {
  if (runner === "agentforce-studio") return toStudioSpec(suite, testName, spec);
  const metrics = spec.format === "scorers" ? [...spec.scorers] : spec.scorers.filter((s) => !ASSERTION_SCORERS.includes(s));
  return {
    name: testName,
    description: `AgentGuard behavioural suite for ${suite.agentApiName} (${suite.cases.length} cases)`,
    subjectType: "AGENT",
    subjectName: suite.agentApiName,
    testCases: suite.cases.map((c) => ({
      utterance: c.utterance,
      expectedTopic: c.expectedTopic,
      expectedActions: c.expectedActions,
      expectedOutcome: c.expectedOutcome,
      customEvaluations: [],
      conversationHistory: [],
      metrics,
    })),
  };
}

/**
 * Spec for the new Agentforce Builder runner (`--test-runner agentforce-studio`, AiTestingDefinition).
 * Verified against a live org (Oct 2026): `name` is required, each case needs `inputs: [{utterance}]`,
 * and assertions are `scorers: [{name, expected}]`; action lists are written as "['A', 'B']".
 */
export function toStudioSpec(suite: Suite, testName: string, spec: AgentGuardConfig["spec"]) {
  const out: Record<string, unknown> = {
    name: testName,
    description: `AgentGuard behavioural suite for ${suite.agentApiName} (${suite.cases.length} cases)`,
    subjectType: "AGENT",
    subjectName: suite.agentApiName,
  };
  if (spec.subjectVersion) out.subjectVersion = spec.subjectVersion;
  out.testCases = suite.cases.map((c) => ({
    inputs: [{ utterance: c.utterance }],
    scorers: [
      { name: "topic_sequence_match", expected: c.expectedTopic },
      { name: "action_sequence_match", expected: `[${(c.expectedActions ?? []).map((a) => `'${a}'`).join(", ")}]` },
      { name: "bot_response_rating", expected: c.expectedOutcome },
    ],
  }));
  return out;
}
