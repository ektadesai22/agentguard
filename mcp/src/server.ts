#!/usr/bin/env node
/**
 * AgentGuard MCP server (stdio).
 *
 * Gives AI coding agents (Claude Code, Cursor, VS Code agent mode) the AgentGuard behavioural gate as
 * MCP tools, next to Copado's own `agentia mcp start` server. Agentia plugins cannot register MCP
 * tools yet, so this is a separate, small server over the same AgentGuard core.
 *
 * Tools: agentguard_check (run the gate), agentguard_report (read the latest report),
 * agentguard_policy (read what the gate enforces). There is deliberately no tool that edits the
 * policy, changes the suite or skips the gate.
 *
 * Project folder: AGENTGUARD_PROJECT_DIR, else the server's working directory.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { describePolicy, readReport, runCheck, summarise } from "./tools.js";

const projectDir = process.env.AGENTGUARD_PROJECT_DIR || process.cwd();

const server = new McpServer({ name: "agentguard", version: "0.1.0" });

server.registerTool(
  "agentguard_check",
  {
    title: "AgentGuard behavioural gate",
    description:
      "Run the AgentGuard behavioural quality gate for an Agentforce agent change: runs the curated test suite on the changed agent " +
      "(Agentforce Studio test runner), compares it with the recorded baseline, applies the policy and explains the result. " +
      "Call this before committing, publishing or submitting any change to agent metadata on a Copado user story. " +
      "Result: PASS / WARN (exit 0), BLOCK (exit 2, behaviour regressed: do not submit) or ERROR (exit 3, could not verify: treat as blocked). " +
      "A live run takes a few minutes.",
    inputSchema: {
      base: z.string().optional().describe("git ref to diff against, or STAGED (default origin/main)"),
      replayBaseline: z.string().optional().describe("recorded baseline run (default runs/baseline-recorded.json)"),
      replayCandidate: z.string().optional().describe("replay saved candidate results instead of a live run (always labelled as a replay)"),
      waitMinutes: z.number().int().min(1).max(60).optional().describe("minutes to wait for each test run (default 15)"),
      workItem: z.string().optional().describe("Copado user story for the report label, e.g. US-0000025"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async (args) => {
    const r = await runCheck(projectDir, args);
    return {
      content: [{ type: "text" as const, text: summarise(r) }],
      structuredContent: r as unknown as Record<string, unknown>,
    };
  },
);

server.registerTool(
  "agentguard_report",
  {
    title: "AgentGuard report",
    description:
      "Read the latest AgentGuard report (markdown) and decision, written by the last gate run from this server, the CLI, " +
      "the Agentia plugin or the Copado local quality gate. Use it to explain a BLOCK and the suggested fix.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    const r = readReport(projectDir);
    return { content: [{ type: "text" as const, text: r.text }], isError: !r.found };
  },
);

server.registerTool(
  "agentguard_policy",
  {
    title: "AgentGuard policy",
    description:
      "Show what the gate enforces: agent, test runner, number and kind of test cases, and the policy thresholds. Read-only: " +
      "the policy and suite are governance files and must not be edited to get a pass.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    const r = describePolicy(projectDir);
    return { content: [{ type: "text" as const, text: r.text }], isError: r.data === undefined };
  },
);

await server.connect(new StdioServerTransport());
