# Upload local .env keys to Fly.io (run from saas-platform after `fly apps create`).
# Usage: powershell -File scripts/push-fly-env.ps1

$env:Path = "C:\Users\Ujval\.fly\bin;" + $env:Path
$skip = @('RECORDINGS_DIR', 'CALL_LOGS_DIR', 'APP_URL', 'VOICE_SERVER_URL')

Get-Content .env | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' } | ForEach-Object {
  $name, $value = $_ -split '=', 2
  if ($skip -contains $name) { return }
  $value = $value.Trim().Trim('"').Trim("'")
  Write-Host "Setting $name ..."
  flyctl secrets set "$name=$value" --stage
}

Write-Host ""
Write-Host "Deploy with: flyctl deploy"
Write-Host "Then set public URL secrets:"
Write-Host "  flyctl secrets set APP_URL=https://priya-voice-agent.fly.dev VOICE_SERVER_URL=https://priya-voice-agent.fly.dev"
