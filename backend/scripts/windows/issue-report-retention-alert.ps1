<#
.SYNOPSIS
  Companion to issue-report-retention-task.ps1 (task "QuranHeals-IssueReport-Retention-Alert"): at logon and
  once a day, shows a message box when <AdminDir>\RETENTION-NEEDS-ATTENTION.txt exists. Reads that one file;
  touches nothing else and never connects to a database.
#>
param([Parameter(Mandatory = $true)][string]$AdminDir)

$marker = Join-Path $AdminDir 'RETENTION-NEEDS-ATTENTION.txt'
if (-not (Test-Path -LiteralPath $marker)) { exit 0 }

Add-Type -AssemblyName System.Windows.Forms
$text = (Get-Content -LiteralPath $marker -Raw) + "`r`n`r`n(File: $marker)"
[System.Windows.Forms.MessageBox]::Show($text, 'Quran Heals: issue-report retention needs attention', 'OK', 'Warning') | Out-Null
exit 0
