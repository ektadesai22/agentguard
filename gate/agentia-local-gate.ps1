# AgentGuard gate script for the Copado Agentia local quality gate (Windows PowerShell).
#
# IMPORTANT: Copado's public docs do not yet document where the local quality gate looks for a
# repo-owned script, which command triggers it, or how it reads exit codes. Confirm the exact
# registration on your machine with `agentia setup` (local quality gates step) and
# `agentia cicd work --help` before relying on this script.
#
# Contract: exit 0 = PASS/WARN (continue), nonzero = BLOCK (2) or ERROR (3) (stop the step).
# Base ref: $env:AGENTGUARD_BASE (default origin/main).

$ErrorActionPreference = "Continue"
$base = if ($env:AGENTGUARD_BASE) { $env:AGENTGUARD_BASE } else { "origin/main" }
$repo = (git rev-parse --show-toplevel 2>$null)
if (-not $repo) { $repo = (Get-Location).Path }
Set-Location $repo

$cli = Join-Path $repo "node_modules/agentguard/dist/cli.js"
if (Test-Path $cli) {
  & node $cli check --base $base @args
  $status = $LASTEXITCODE
} elseif (Get-Command agentia -ErrorAction SilentlyContinue) {
  & agentia agentguard check --base $base @args
  $status = $LASTEXITCODE
} else {
  Write-Error "AgentGuard ERROR: neither node_modules/agentguard nor the agentia CLI was found."
  exit 3
}

switch ($status) {
  0 { Write-Host "AgentGuard: PASS/WARN - quality gate passed."; exit 0 }
  2 { Write-Error "AgentGuard: BLOCK - behaviour regressed. Quality gate failed."; exit 2 }
  default { Write-Error "AgentGuard: ERROR (exit $status) - change could not be verified. Quality gate failed."; exit 3 }
}
