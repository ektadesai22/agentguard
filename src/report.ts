import type { GateDecision, SuiteMetrics } from "./types.js";
import { explain } from "./explain.js";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function metricRows(b: SuiteMetrics, c: SuiteMetrics): [string, string, string][] {
  return [
    ["Agent Behaviour Score", String(b.abs), String(c.abs)],
    ["Routing accuracy", pct(b.routingAccuracy), pct(c.routingAccuracy)],
    ["Action accuracy", pct(b.actionAccuracy), pct(c.actionAccuracy)],
    ["Outcome pass rate", pct(b.outcomePassRate), pct(c.outcomePassRate)],
    ["Safety pass rate", pct(b.safetyPassRate), pct(c.safetyPassRate)],
    ["Cases", String(b.total), String(c.total)],
  ];
}

export function toMarkdown(d: GateDecision, title = "AgentGuard report", note?: string): string {
  const { diff } = d;
  const lines = [`# ${title}`, "", ...(note ? [`> ${note}`, ""] : []), `**Gate: ${d.status}**`, "", ...explain(d).map((l) => `- ${l}`), "", "| Metric | Baseline | Candidate |", "|---|---|---|"];
  for (const [m, b, c] of metricRows(diff.baseline, diff.candidate)) lines.push(`| ${m} | ${b} | ${c} |`);
  const regressed = diff.flips.filter((f) => f.direction === "regressed");
  if (regressed.length) {
    lines.push("", "## Regressed cases", "", "| Case | Dimension | Utterance | Expected | Baseline | Candidate |", "|---|---|---|---|---|---|");
    for (const f of regressed) lines.push(`| ${f.id} | ${f.dimension} | ${f.utterance} | ${f.expected} | ${f.baseline} | ${f.candidate} |`);
  }
  return lines.join("\n") + "\n";
}

export function toJUnit(d: GateDecision, suiteName = "AgentGuard"): string {
  const cases = d.reasons
    .map((r) => {
      const body =
        r.status === "BLOCK" ? `<failure message="${esc(r.message)}"/>` : r.status === "ERROR" ? `<error message="${esc(r.message)}"/>` : "";
      return `    <testcase classname="agentguard.gate" name="${esc(r.rule)}">${body}</testcase>`;
    })
    .join("\n");
  const failures = d.reasons.filter((r) => r.status === "BLOCK").length;
  const errors = d.reasons.filter((r) => r.status === "ERROR").length;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n  <testsuite name="${esc(suiteName)}" tests="${d.reasons.length}" failures="${failures}" errors="${errors}">\n${cases}\n  </testsuite>\n</testsuites>\n`;
}

export function toHtml(d: GateDecision, title = "AgentGuard report", note?: string): string {
  const { diff } = d;
  const color = d.status === "BLOCK" || d.status === "ERROR" ? "#b42318" : d.status === "WARN" ? "#b54708" : "#067647";
  const rows = metricRows(diff.baseline, diff.candidate)
    .map(([m, b, c]) => `<tr><td>${m}</td><td>${b}</td><td><strong>${c}</strong></td></tr>`)
    .join("");
  const grouped = new Map<string, { utterance: string; dims: string[]; expected: string; got: string }>();
  for (const f of diff.flips.filter((f) => f.direction === "regressed")) {
    const g = grouped.get(f.id) ?? { utterance: f.utterance, dims: [], expected: "", got: "" };
    g.dims.push(f.dimension);
    if (f.dimension === "routing") { g.expected = f.expected; g.got = f.candidate; }
    if (f.dimension === "action" && !g.expected) { g.expected = f.expected; g.got = f.candidate; }
    grouped.set(f.id, g);
  }
  const flips = [...grouped.entries()]
    .map(([id, g]) => `<tr><td>${esc(id)}</td><td>${esc(g.utterance)}</td><td>${g.dims.join(", ")}</td><td>${esc(g.expected)}</td><td>${esc(g.got)}</td></tr>`)
    .join("");
  const rules = d.reasons
    .map((r) => `<tr><td>${esc(r.rule)}</td><td><strong>${r.status}</strong></td><td>${esc(r.message)}</td></tr>`)
    .join("");
  const misroutes = diff.misroutes
    .map((m) => `<tr><td>${esc(m.expectedTopic)}</td><td>${esc(m.actualTopic)}</td><td>${m.count}</td><td>${Math.round(m.share * 100)}%</td></tr>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#f6f7fb;color:#1d2433}main{max-width:960px;margin:0 auto;padding:24px 16px}
.badge{display:inline-block;padding:6px 14px;border-radius:999px;color:#fff;background:${color};font-weight:700;letter-spacing:.04em}
section{background:#fff;border-radius:12px;padding:18px 20px;margin:16px 0;box-shadow:0 1px 2px rgba(0,0,0,.06)}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px;border-bottom:1px solid #e6e8ef;vertical-align:top}
th{color:#5b6475;font-weight:600}h1{margin:.2em 0}h2{font-size:17px;margin:0 0 10px}li{margin:4px 0}.note{background:#fff4e5;border:1px solid #f5c27a;border-radius:8px;padding:8px 12px}</style></head>
<body><main><h1>${esc(title)}</h1><span class="badge">GATE: ${d.status}</span>
${note ? `<p class="note">${esc(note)}</p>` : ""}
<section><h2>What changed, in plain English</h2><ul>${explain(d).map((l) => `<li>${esc(l)}</li>`).join("")}</ul></section>
<section><h2>Scorecard</h2><table><tr><th>Metric</th><th>Baseline</th><th>Candidate</th></tr>${rows}</table></section>
${misroutes ? `<section><h2>Routing confusion (candidate)</h2><table><tr><th>Expected topic</th><th>Routed to</th><th>Cases</th><th>Share</th></tr>${misroutes}</table></section>` : ""}
${flips ? `<section><h2>Regressed cases</h2><table><tr><th>Case</th><th>Utterance</th><th>Regressed on</th><th>Expected</th><th>Candidate</th></tr>${flips}</table></section>` : ""}
<section><h2>Gate policy</h2><table><tr><th>Rule</th><th>Result</th><th>Detail</th></tr>${rules}</table></section>
</main></body></html>`;
}
