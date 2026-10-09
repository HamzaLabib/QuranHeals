<#
.SYNOPSIS
  Monthly issue-report retention run for Windows Task Scheduler (task "QuranHeals-IssueReport-Retention";
  docs/data-retention.md, "Monthly operation and monitoring").

.DESCRIPTION
  Runs the existing retention script, unattended, with the production-retention profile:

    issueReportRetention.ts purge --holds <AdminDir>\holds.json --audit-log <AdminDir>\audit.jsonl
                                  --apply --unattended --max-delete <MaxDelete>

  then `status` on the same audit log. Every safeguard stays in the retention script itself: the exact
  12-calendar-month rule, holds, the strict least-privilege check (find + remove on issuereports only),
  the re-validation before deleting, the database-side createdAt backstop, the run lock, and the audit
  entries. This wrapper only adds what a scheduled run needs:

    - a timestamped log in <AdminDir>\logs (report ids and counts only; the tool never prints content),
    - <AdminDir>\RETENTION-NEEDS-ATTENTION.txt on any failure, refusal or `status` warning (cleared by
      the next clean run), shown by the companion alert task,
    - a non-zero exit code for Task Scheduler's "Last Run Result".

  -MaxDelete 0 can never delete anything: with reports due, the run refuses (and is reported as a
  failure); with none due it only records an `issue-reports-checked` audit entry.

  QURAN_HEALS_CONFIRM_PRODUCTION_WRITE is set for this process only, never stored in a profile.
#>
param(
  [Parameter(Mandatory = $true)][string]$AdminDir,
  [Parameter(Mandatory = $true)][ValidateRange(0, 500)][int]$MaxDelete
)

$ErrorActionPreference = 'Stop'
$BackendDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$LogDir = Join-Path $AdminDir 'logs'
$Marker = Join-Path $AdminDir 'RETENTION-NEEDS-ATTENTION.txt'
$Stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$Log = Join-Path $LogDir "retention-$Stamp.log"
$LogRetentionDays = 400

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-Log([string]$Message) {
  Add-Content -LiteralPath $Log -Value ('{0} {1}' -f (Get-Date).ToUniversalTime().ToString('o'), $Message) -Encoding UTF8
}

# Windows PowerShell 5.1's Start-Process joins arguments without quoting; quote each one ourselves.
function Join-Arguments([string[]]$Arguments) {
  ($Arguments | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join ' '
}

function Invoke-Node([string]$Step, [string[]]$Arguments) {
  $out = Join-Path $LogDir "$Stamp-$Step.stdout.tmp"
  $err = Join-Path $LogDir "$Stamp-$Step.stderr.tmp"
  try {
    $process = Start-Process -FilePath $script:Node -ArgumentList (Join-Arguments $Arguments) -WorkingDirectory $BackendDir `
      -NoNewWindow -Wait -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    Write-Log "$Step exit code $($process.ExitCode)"
    foreach ($file in @($out, $err)) {
      if (Test-Path -LiteralPath $file) { Get-Content -LiteralPath $file | ForEach-Object { Write-Log "  $_" } }
    }
    return $process.ExitCode
  } finally {
    Remove-Item -LiteralPath $out, $err -Force -ErrorAction SilentlyContinue
  }
}

function Set-Attention([string]$Reason) {
  $text = @(
    "Quran Heals issue-report retention needs attention.",
    "When (UTC): $((Get-Date).ToUniversalTime().ToString('o'))",
    "Reason:     $Reason",
    "Log:        $Log",
    "Next steps: docs/data-retention.md, 'Recovery'. Delete this file once handled."
  ) -join "`r`n"
  Set-Content -LiteralPath $Marker -Value $text -Encoding UTF8
  Write-Log "ATTENTION: $Reason"
}

$exitCode = 0
try {
  Write-Log "start: mode=purge --apply --unattended --max-delete $MaxDelete backend=$BackendDir admin=$AdminDir"
  foreach ($required in @('prod-retention.env', 'holds.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $AdminDir $required))) { throw "Missing $required in $AdminDir" }
  }
  $script:Node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $script:Node) { $script:Node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
  $tsx = Join-Path $BackendDir 'node_modules\tsx\dist\cli.mjs'
  if (-not (Test-Path -LiteralPath $script:Node)) { throw "node.exe not found" }
  if (-not (Test-Path -LiteralPath $tsx)) { throw "tsx not installed in $BackendDir (run npm ci)" }

  # This process only: never read backend/.env, and confirm the production write the script asks for.
  $env:QURAN_HEALS_SKIP_DOTENV = '1'
  $env:QURAN_HEALS_CONFIRM_PRODUCTION_WRITE = 'quranheals_prod'

  $holds = Join-Path $AdminDir 'holds.json'
  $audit = Join-Path $AdminDir 'audit.jsonl'
  $purge = Invoke-Node 'purge' @($tsx, "--env-file=$(Join-Path $AdminDir 'prod-retention.env')", 'src/scripts/issueReportRetention.ts',
    'purge', '--holds', $holds, '--audit-log', $audit, '--apply', '--unattended', '--max-delete', "$MaxDelete")
  $status = Invoke-Node 'status' @($tsx, 'src/scripts/issueReportRetention.ts', 'status', '--audit-log', $audit)

  if ($purge -ne 0) {
    $exitCode = $purge
    Set-Attention "cleanup exited with code $purge (1 refused, e.g. more than --max-delete due, lock present or interrupted run; 5 deletion failed)"
  } elseif ($status -ne 0) {
    $exitCode = 6
    Set-Attention "status reports a problem (exit code $status)"
  } else {
    if (Test-Path -LiteralPath $Marker) { Remove-Item -LiteralPath $Marker -Force; Write-Log 'previous attention marker cleared by a clean run' }
    Write-Log 'result: ok'
  }
} catch {
  $exitCode = 1
  Set-Attention "wrapper error: $($_.Exception.Message)"
}

try {
  Get-ChildItem -LiteralPath $LogDir -Filter 'retention-*.log' -File |
    Where-Object { $_.LastWriteTimeUtc -lt (Get-Date).ToUniversalTime().AddDays(-$LogRetentionDays) } |
    Remove-Item -Force
} catch {
  Write-Log "log cleanup skipped: $($_.Exception.Message)"
}

Write-Log "end: exit code $exitCode"
exit $exitCode
