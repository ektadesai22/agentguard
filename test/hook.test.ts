import { describe, expect, it } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hook = join(__dirname, "..", "hooks", "pre-push");
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "agentguard-test",
  GIT_AUTHOR_EMAIL: "test@agentguard.invalid",
  GIT_COMMITTER_NAME: "agentguard-test",
  GIT_COMMITTER_EMAIL: "test@agentguard.invalid",
};

/** Temp repo with a `base` branch and a HEAD commit that changes the given file. */
function makeRepo(changedFile: string) {
  const dir = mkdtempSync(join(tmpdir(), "ag-hook-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env: gitEnv, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  writeFileSync(join(dir, "README.md"), "x\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  git("branch", "base");
  const p = join(dir, changedFile);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, "<changed/>\n");
  git("add", ".");
  git("commit", "-q", "-m", "change");
  // Fake local agentguard binary: exits with $FAKE_EXIT.
  mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
  const fake = join(dir, "node_modules", ".bin", "agentguard");
  writeFileSync(fake, "#!/usr/bin/env node\nprocess.exit(Number(process.env.FAKE_EXIT ?? 9));\n");
  chmodSync(fake, 0o755);
  return dir;
}

function runHook(dir: string, env: Record<string, string>) {
  return spawnSync("sh", [hook], { cwd: dir, env: { ...gitEnv, ...env }, encoding: "utf8" });
}

describe("hooks/pre-push (fail closed)", () => {
  const agentChange = "force-app/main/default/genAiPlugins/Order_Status.genAiPlugin-meta.xml";

  it("allows the push when agentguard exits 0", () => {
    const r = runHook(makeRepo(agentChange), { AGENTGUARD_BASE: "base", FAKE_EXIT: "0" });
    expect(r.status).toBe(0);
  });

  for (const code of ["1", "2", "3"]) {
    it(`refuses the push when agentguard exits ${code}`, () => {
      const r = runHook(makeRepo(agentChange), { AGENTGUARD_BASE: "base", FAKE_EXIT: code });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(code === "2" ? /BLOCK/ : /ERROR/);
    });
  }

  it("refuses the push when the base ref does not exist", () => {
    const r = runHook(makeRepo(agentChange), { AGENTGUARD_BASE: "origin/does-not-exist", FAKE_EXIT: "0" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/base ref/);
  });

  it("skips the gate when no agent metadata changed", () => {
    const r = runHook(makeRepo("src/app.js"), { AGENTGUARD_BASE: "base", FAKE_EXIT: "3" });
    expect(r.status).toBe(0);
  });

  it("runs the gate for Agent Script (aiAuthoringBundles) changes", () => {
    const r = runHook(makeRepo("force-app/main/default/aiAuthoringBundles/Order_Concierge/Order_Concierge.agent"), { AGENTGUARD_BASE: "base", FAKE_EXIT: "2" });
    expect(r.status).not.toBe(0);
  });
});

describe("gate/agentia-local-gate.sh", () => {
  const gate = join(__dirname, "..", "gate", "agentia-local-gate.sh");
  const cases: [string, number][] = [["0", 0], ["2", 2], ["1", 3], ["3", 3]];
  for (const [fake, expected] of cases) {
    it(`agentguard exit ${fake} -> gate exit ${expected}`, () => {
      const dir = makeRepo("force-app/main/default/genAiPlugins/Order_Status.genAiPlugin-meta.xml");
      const r = spawnSync("sh", [gate], { cwd: dir, env: { ...gitEnv, AGENTGUARD_BASE: "base", FAKE_EXIT: fake }, encoding: "utf8" });
      expect(r.status).toBe(expected);
    });
  }
});
