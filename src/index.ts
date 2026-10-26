// Public API of the AgentGuard core package (used by the Agentia plugin in plugin/).
export { loadConfig, validateConfig, DEFAULT_CONFIG, DEFAULT_POLICY, KNOWN_SCORERS, REQUIRED_SCORERS } from "./config.js";
export type { AgentGuardConfig, Policy, TestRunner } from "./config.js";
export { buildImpact, gitChangedFiles, loadTopics, classifyPath, parseNameStatus } from "./detect.js";
export { evaluateGate, exitCodeFor, coverageErrors } from "./gate.js";
export { check } from "./pipeline.js";
export type { CheckOptions, CheckOutput } from "./pipeline.js";
export { SfRunner, ReplayRunner } from "./runner.js";
export type { Runner, RunOutput } from "./runner.js";
export { joinResults, normaliseResults, safetyVerdict, findLeaks } from "./results.js";
export { loadSuite, validateSuite, toSalesforceSpec } from "./suite.js";
export { explain } from "./explain.js";
export type * from "./types.js";
