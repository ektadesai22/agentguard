import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describePolicy, readReport, runCheck } from "../src/tools.js";

const here = dirname(fileURLToPath(import.meta.url));
// The bundled Order Concierge example; its fixtures are SYNTHETIC (replay only).
const example = resolve(here, "..", "..", "examples", "order-concierge");
const replay = (scenario: "regressed" | "fixed") => ({
  base: "STAGED",
  replayBaseline: "fixtures/baseline.json",
  replayCandidate: `fixtures/candidate-${scenario}.json`,
  workItem: "US-TEST",
});

describe("tools", () => {
  it("BLOCKs the regressed change with exit 2 and tells the agent not to submit", async () => {
    const r = await runCheck(example, replay("regressed"));
    expect(r.status).toBe("BLOCK");
    expect(r.exitCode).toBe(2);
    expect(r.mode).toBe("replay");
    expect(r.note).toMatch(/Replay/);
    expect(r.nextStep).toMatch(/Do NOT commit, submit or promote/);
    expect(r.scores!.candidate.agentBehaviourScore).toBeLessThan(r.scores!.baseline.agentBehaviourScore);
  });

  it("PASSes the fixed change with exit 0", async () => {
    const r = await runCheck(example, replay("fixed"));
    expect(["PASS", "WARN"]).toContain(r.status);
    expect(r.exitCode).toBe(0);
  });

  it("fails closed (ERROR, exit 3) when the candidate results are missing", async () => {
    const r = await runCheck(example, { ...replay("regressed"), replayCandidate: "fixtures/missing.json" });
    expect(r.status).toBe("ERROR");
    expect(r.exitCode).toBe(3);
    expect(r.nextStep).toMatch(/treat it as blocked/);
  });

  it("fails closed when there is no AgentGuard config", async () => {
    const empty = mkdtempSync(join(tmpdir(), "ag-mcp-"));
    try {
      const r = await runCheck(empty, {});
      expect(r.status).toBe("ERROR");
      expect(r.exitCode).toBe(3);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("reads the latest report and describes the policy read-only", async () => {
    await runCheck(example, replay("regressed"));
    const rep = readReport(example);
    expect(rep.found).toBe(true);
    expect(rep.text).toMatch(/BLOCK/);
    const pol = describePolicy(example);
    expect(pol.text).toMatch(/must not edit/);
    expect((pol.data as { cases: number }).cases).toBeGreaterThan(0);
  });
});

describe("MCP over stdio", () => {
  const serverJs = resolve(here, "..", "dist", "server.js");
  let client: Client;

  beforeAll(async () => {
    if (!existsSync(serverJs)) throw new Error("run `npm run build` first");
    client = new Client({ name: "agentguard-test", version: "0.0.0" });
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [serverJs], env: { ...process.env, AGENTGUARD_PROJECT_DIR: example } as Record<string, string> }),
    );
  });
  afterAll(async () => {
    await client?.close();
  });

  it("lists exactly the three tools, with no tool that edits policy or skips the gate", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["agentguard_check", "agentguard_policy", "agentguard_report"]);
  });

  it("agentguard_check returns BLOCK as text and structured content", async () => {
    const res = await client.callTool({ name: "agentguard_check", arguments: replay("regressed") });
    const text = (res.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toMatch(/AgentGuard gate: BLOCK \(exit 2\) for US-TEST/);
    expect(text).toMatch(/Replay of saved results/);
    expect((res.structuredContent as { exitCode: number }).exitCode).toBe(2);
  });
});
