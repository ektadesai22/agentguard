import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { AgentMetadataType, ChangedFile, ImpactSet } from "./types.js";

interface Rule {
  type: AgentMetadataType;
  re: RegExp;
}

// Source-format path patterns for Agentforce metadata.
const RULES: Rule[] = [
  { type: "GenAiPlannerBundle", re: /genAiPlannerBundles\/([^/]+)\// },
  { type: "GenAiPlugin", re: /genAiPlugins\/([^/.]+)\.genAiPlugin-meta\.xml$/ },
  { type: "GenAiFunction", re: /genAiFunctions\/([^/]+)\// },
  { type: "GenAiPromptTemplate", re: /genAiPromptTemplates\/([^/.]+)\.genAiPromptTemplate-meta\.xml$/ },
  { type: "BotVersion", re: /bots\/([^/]+)\/[^/]+\.botVersion-meta\.xml$/ },
  { type: "Bot", re: /bots\/([^/]+)\/[^/]+\.bot-meta\.xml$/ },
  { type: "AiAuthoringBundle", re: /aiAuthoringBundles\/([^/]+)\// },
];

// Agents built in the new Agentforce Builder are stored as Agent Script in aiAuthoringBundles/.
// Any change there can affect every subagent, so it always triggers a full run.
const FULL_RUN_TYPES: AgentMetadataType[] = ["GenAiPlannerBundle", "Bot", "BotVersion", "AiAuthoringBundle"];

export function classifyPath(path: string): { type: AgentMetadataType; apiName: string } | undefined {
  const p = path.replace(/\\/g, "/");
  for (const r of RULES) {
    const m = p.match(r.re);
    if (m) return { type: r.type, apiName: m[1] };
  }
  return undefined;
}

/** Parse `git diff --name-status` output into agent metadata changes. */
export function parseNameStatus(output: string): ChangedFile[] {
  const out: ChangedFile[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const status = parts[0][0] as ChangedFile["status"];
    const path = parts[parts.length - 1];
    const c = classifyPath(path);
    if (c) out.push({ path, status, metadataType: c.type, apiName: c.apiName });
  }
  return out;
}

export function gitChangedFiles(base: string, cwd = process.cwd()): ChangedFile[] {
  const args = base === "STAGED" ? ["diff", "--cached", "--name-status"] : ["diff", "--name-status", `${base}...HEAD`];
  const output = execFileSync("git", args, { cwd, encoding: "utf8" });
  return parseNameStatus(output);
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/**
 * Map of topic API name -> raw XML of its GenAiPlugin file.
 * NOTE: topics are only read from genAiPlugins/ (legacy builder metadata). Subagents defined
 * inside Agent Script (aiAuthoringBundles/) are not parsed; a change there forces a full run
 * (see FULL_RUN_TYPES), and the full golden suite is always executed regardless of impact.
 * Topic metadata is only used to focus optional case generation.
 */
export function loadTopics(sourceDir: string): Map<string, string> {
  const topics = new Map<string, string>();
  for (const f of walk(join(sourceDir, "genAiPlugins"))) {
    if (f.endsWith(".genAiPlugin-meta.xml")) {
      topics.set(basename(f).replace(".genAiPlugin-meta.xml", ""), readFileSync(f, "utf8"));
    }
  }
  return topics;
}

/**
 * Build the impact set: which topics (subagents) and actions can behave differently
 * because of the changed files. Actions and prompt templates are mapped back to every
 * topic whose XML references them.
 */
export function buildImpact(changed: ChangedFile[], sourceDir: string): ImpactSet {
  const topics = loadTopics(sourceDir);
  const impactedTopics = new Set<string>();
  const impactedActions = new Set<string>();
  let fullRun = false;

  for (const c of changed) {
    if (FULL_RUN_TYPES.includes(c.metadataType)) fullRun = true;
    if (c.metadataType === "GenAiPlugin") impactedTopics.add(c.apiName);
    if (c.metadataType === "GenAiFunction" || c.metadataType === "GenAiPromptTemplate") {
      impactedActions.add(c.apiName);
      for (const [topic, xml] of topics) if (xml.includes(c.apiName)) impactedTopics.add(topic);
    }
  }
  // Note: a topic change can steal utterances from its neighbours, so the runner always
  // executes the full golden suite; impactedTopics only focuses *generation* of new cases.
  if (fullRun) for (const t of topics.keys()) impactedTopics.add(t);

  return {
    changed,
    impactedTopics: [...impactedTopics].sort(),
    impactedActions: [...impactedActions].sort(),
    fullRun,
  };
}
