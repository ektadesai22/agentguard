@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM Local Agentia quality gates (Windows) - AgentGuard behavioural gate for Agentforce agents.
REM Agentia runs this from the repo root during `agentia cicd work test` and `agentia cicd work submit`
REM (unless --skip-local-tests). Any non-zero exit fails the step.
REM AgentGuard exit codes: 0 PASS/WARN, 2 BLOCK (behaviour regressed), 3 ERROR (unverified = fail closed).

echo ## AgentGuard: behavioural gate for the Order_Concierge agent
if not exist "agentguard.config.yaml" (
  echo AgentGuard ERROR: agentguard.config.yaml not found in repo root - refusing to pass.
  exit /b 3
)
where agentguard >nul 2>nul
if errorlevel 1 (
  echo AgentGuard ERROR: agentguard CLI not installed ^(run npm link in the agentguard folder^) - refusing to pass.
  exit /b 3
)

set "AG_BASELINE=runs\baseline-recorded.json"
if exist "%AG_BASELINE%" (
  echo Baseline: recorded run %AG_BASELINE%  ^|  Candidate: live run in ag-dev
  call agentguard check --replay-baseline "%AG_BASELINE%"
) else (
  echo No recorded baseline yet: running baseline and candidate live in the configured orgs
  call agentguard check
)
set "AG_RC=!errorlevel!"
if "!AG_RC!"=="0" (
  echo AgentGuard PASS - report: .agentguard\report\report.html
) else if "!AG_RC!"=="2" (
  echo AgentGuard BLOCK - agent behaviour regressed. See .agentguard\report\report.html
  exit /b 2
) else (
  echo AgentGuard ERROR ^(exit !AG_RC!^) - result unverified, refusing to pass. See .agentguard\report\report.html
  exit /b !AG_RC!
)

exit /b 0
