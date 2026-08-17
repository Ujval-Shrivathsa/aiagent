# Upload local .env keys to Railway (run from saas-platform after `railway link`).
# Usage: powershell -File scripts/push-railway-env.ps1

$skip = @(
  'RECORDINGS_DIR',
  'CALL_LOGS_DIR'
)

Get-Content .env | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' } | ForEach-Object {
  $name, $value = $_ -split '=', 2
  if ($skip -contains $name) { return }
  $value = $value.Trim().Trim('"').Trim("'")
  Write-Host "Setting $name ..."
  railway variables set "$name=$value" --skip-deploys
}

Write-Host ""
Write-Host "After deploy, set APP_URL and VOICE_SERVER_URL to your Railway public HTTPS URL, then:"
Write-Host "  railway variables set APP_URL=https://YOUR-APP.up.railway.app"
Write-Host "  railway variables set VOICE_SERVER_URL=https://YOUR-APP.up.railway.app"
Write-Host "  railway redeploy"
