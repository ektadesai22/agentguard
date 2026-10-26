import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normaliseResults, runProblems } from "../src/results.js";
import { toSalesforceSpec } from "../src/suite.js";
import type { Suite } from "../src/types.js";

// Real raw results from a live agentforce-studio run (Order_Concierge, Oct 2026).
const load = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));

describe("agentforce-studio results (live files)", () => {
  it("parses a passing live run: routing, actions and response all pass, joined by utterance", () => {
    const raw = load("studio-live-pass.json");
    expect(runProblems(raw)).toEqual([]);
    const r = normaliseResults(raw);
    expect(r).toHaveLength(2);
    const order = r.find((x) => x.utterance === "Where is my order 100245?")!;
    expect(order.actualTopic).toBe("Order_Status");
    expect(order.actualActions).toEqual(["Get_Order_Status"]);
    expect(order.routingPass && order.actionPass && order.outcomePass).toBe(true);
    expect(order.response).toContain("TRK-45120");
    expect(order.problems).toEqual([]);
  });

  it("detects the live failure where the agent never called its action", () => {
    const r = normaliseResults(load("studio-live-noaction.json"));
    for (const c of r) {
      expect(c.routingPass).toBe(true);
      expect(c.actualActions).toEqual([]);
      expect(c.actionPass).toBe(false);
      expect(c.outcomePass).toBe(false);
    }
  });

  it("reports a missing scorer as a problem (fail closed), never a pass", () => {
    const raw = load("studio-live-pass.json");
    raw.testCases[0].testScorerResults = raw.testCases[0].testScorerResults.filter((s: { scorerName: string }) => s.scorerName !== "Response Evaluation");
    const r = normaliseResults(raw);
    expect(r[0].outcomePass).toBe(false);
    expect(r[0].problems.join(" ")).toMatch(/missing outcome scorer/);
  });
});

describe("agentforce-studio spec", () => {
  it("writes the verified shape: name, inputs[].utterance, scorers[{name, expected}]", () => {
    const suite: Suite = { agentApiName: "Order_Concierge", cases: [{ id: "c1", category: "positive", utterance: "Where is my order 100245?", expectedTopic: "Order_Status", expectedActions: ["Get_Order_Status"], expectedOutcome: "Says delivered." }] } as Suite;
    const spec = toSalesforceSpec(suite, "AG_Test", { format: "scorers", scorers: ["topic_sequence_match", "action_sequence_match", "bot_response_rating"], subjectVersion: "v5" }, "agentforce-studio") as Record<string, any>;
    expect(spec.name).toBe("AG_Test");
    expect(spec.subjectVersion).toBe("v5");
    expect(spec.testCases[0].inputs).toEqual([{ utterance: "Where is my order 100245?" }]);
    expect(spec.testCases[0].scorers).toEqual([
      { name: "topic_sequence_match", expected: "Order_Status" },
      { name: "action_sequence_match", expected: "['Get_Order_Status']" },
      { name: "bot_response_rating", expected: "Says delivered." },
    ]);
  });
});

describe("Windows sf invocation", () => {
  it("quotes arguments with spaces for the cmd shell", async () => {
    const { quoteWinArg } = await import("../src/runner.js");
    expect(quoteWinArg("--api-name")).toBe("--api-name");
    expect(quoteWinArg("C:\\Users\\x\\OneDrive - Example Co\\spec.yaml")).toBe('"C:\\Users\\x\\OneDrive - Example Co\\spec.yaml"');
  });
});

describe("safety cases and routing", () => {
  it("does not count a safety case intercepted by a platform guardrail topic as a misroute", async () => {
    const { computeMetrics } = await import("../src/score.js");
    const base = { expectedActions: [], actualActions: [], actionPass: true, outcomePass: true, problems: [], safetyPass: true } as any;
    const m = computeMetrics(
      [
        { ...base, id: "p1", category: "positive", utterance: "a", expectedTopic: "Order_Status", actualTopic: "Order_Status", routingPass: true },
        { ...base, id: "s1", category: "safety", utterance: "b", expectedTopic: "Off_Topic", actualTopic: "Prompt_Injection", routingPass: false },
      ],
      { routing: 0.35, action: 0.3, outcome: 0.2, safety: 0.15 },
    );
    expect(m.routingAccuracy).toBe(1);
    expect(m.safetyPassRate).toBe(1);
  });
});
