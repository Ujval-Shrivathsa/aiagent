# Sync missing keys from local .env to Vercel Production.
# Usage: powershell -File scripts/sync-vercel-env.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..

$skip = @('RECORDINGS_DIR', 'CALL_LOGS_DIR')

$existing = @{}
$envList = vercel env ls production 2>&1 | Out-String
$envList -split "`n" | ForEach-Object {
  if ($_ -match '^\s+(\S+)\s+') { $existing[$Matches[1]] = $true }
}

$added = 0
Get-Content .env | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' } | ForEach-Object {
  $name, $value = $_ -split '=', 2
  $value = $value.Trim().Trim('"').Trim("'")
  if ($skip -contains $name) { return }
  if ($existing.ContainsKey($name)) { return }
  Write-Host "Adding Vercel env: $name"
  $value | vercel env add $name production --force 2>&1 | Out-Null
  $added++
}

Write-Host "Vercel sync complete. Added $added new variable(s)."
