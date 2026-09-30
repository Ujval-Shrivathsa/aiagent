# One-shot production setup (run from saas-platform).
# Usage: powershell -ExecutionPolicy Bypass -File scripts/setup-production.ps1
# Optional: -PublicUrl https://priya-voice-agent.onrender.com

param(
  [string]$PublicUrl = ''
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..

Write-Host "=== Alliance Square production setup ===" -ForegroundColor Cyan

# 1. Prisma schema → Supabase (direct connection)
Write-Host "`n[1/4] Pushing database schema..." -ForegroundColor Yellow
$direct = (Select-String -Path .env -Pattern '^DIRECT_URL=' | Select-Object -First 1).Line
if ($direct -match '^DIRECT_URL=(.+)$') {
  $dbUrl = $Matches[1].Trim().Trim('"').Trim("'")
  $env:DATABASE_URL = $dbUrl
  npx prisma db push --accept-data-loss
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "prisma db push failed — check DIRECT_URL in .env and retry."
  } else {
    Write-Host "Database schema OK." -ForegroundColor Green
  }
} else {
  Write-Warning "No DIRECT_URL in .env — skip prisma db push."
}

# 2. Render env paste file
Write-Host "`n[2/4] Generating Render env paste file..." -ForegroundColor Yellow
node scripts/generate-render-env.mjs
Write-Host "Open render-env.paste.txt and paste into Render Environment." -ForegroundColor Green

# 3. Render blueprint (manual — needs browser login)
Write-Host "`n[3/4] Render voice server (24/7 calls)..." -ForegroundColor Yellow
Write-Host @"

  Railway trial is expired — use Render (free):

  1. Open: https://dashboard.render.com/select-repo?type=blueprint
  2. Connect GitHub repo: Ujval-Shrivathsa/aiagent
  3. Apply blueprint (priya-voice-agent)
  4. Paste env from: saas-platform/render-env.paste.txt
  5. After deploy, copy URL e.g. https://priya-voice-agent.onrender.com
  6. In Render Environment set:
       APP_URL=<your-render-url>
       VOICE_SERVER_URL=<your-render-url>
  7. Re-run this script with your URL:
       powershell -File scripts/setup-production.ps1 -PublicUrl https://priya-voice-agent.onrender.com

"@

if (-not $PublicUrl) {
  $PublicUrl = Read-Host "Enter your public voice host URL (or press Enter to skip Plivo config)"
}

if ($PublicUrl) {
  $PublicUrl = $PublicUrl.Trim().TrimEnd('/')
  Write-Host "`n[4/4] Configuring Plivo webhooks for $PublicUrl ..." -ForegroundColor Yellow
  node scripts/configure-plivo-app.mjs $PublicUrl
  Write-Host "Update local .env APP_URL and VOICE_SERVER_URL to $PublicUrl for outbound test calls." -ForegroundColor Green
} else {
  Write-Host "`n[4/4] Skipped Plivo config — provide -PublicUrl after Render is live." -ForegroundColor Yellow
}

Write-Host "`n=== Setup script finished ===" -ForegroundColor Cyan
