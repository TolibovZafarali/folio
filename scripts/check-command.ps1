param(
  [Parameter(Mandatory = $true)][string]$Title,
  [Parameter(Mandatory = $true)][string]$Command,
  [Parameter()][string[]]$CommandArguments = @()
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$logDirectory = Join-Path $env:RUNNER_TEMP 'folio-desktop-check'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$filename = ($Title -replace '[^a-zA-Z0-9_-]', '-') + '.log'
$logPath = Join-Path $logDirectory $filename
$exitCode = 1
try {
  & $Command @CommandArguments 2>&1 | Tee-Object -FilePath $logPath
  $exitCode = $LASTEXITCODE
  if ($null -eq $exitCode) { $exitCode = 0 }
} catch {
  $_.Exception.Message | Tee-Object -FilePath $logPath -Append
  $exitCode = 1
}
if ($exitCode -ne 0) {
  $output = if (Test-Path $logPath) { Get-Content $logPath -Raw } else { 'The command failed before producing output.' }
  # Emit test/build output only; never inspect environment or credential files.
  # Redact URL userinfo and common credential assignments if a dependency logs them.
  $output = $output -replace '(?i)(https?://)[^/\s@]+@', '$1[redacted]@'
  $output = $output -replace '(?im)((?:authorization|access[_-]?token|auth[_-]?token|password|secret)\s*[:=]\s*)[^\r\n]+', '$1[redacted]'
  $output = $output -replace '(?i)\b(?:gh[pousr]_[a-z0-9_]+|github_pat_[a-z0-9_]+)\b', '[redacted]'
  if ($output.Length -gt 6000) { $output = $output.Substring($output.Length - 6000) }
  $escaped = $output.Replace('%', '%25').Replace("`r", '%0D').Replace("`n", '%0A')
  $safeTitle = $Title.Replace('%', '%25').Replace("`r", '%0D').Replace("`n", '%0A').Replace(':', '%3A').Replace(',', '%2C')
  Write-Output "::error title=${safeTitle}::${escaped}"
}
exit $exitCode
