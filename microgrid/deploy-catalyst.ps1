# Deploys EcoCypher (web app + microgrid API) to Zoho Catalyst AppSail.
# Run from PowerShell:
#   cd "C:\ECOCYPHER-- COLLAB\ecocypher-app\microgrid"
#   powershell -ExecutionPolicy Bypass -File .\deploy-catalyst.ps1            # deploy
#   powershell -ExecutionPolicy Bypass -File .\deploy-catalyst.ps1 -Rebuild   # rebuild the web app first
param([switch]$Rebuild)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is required. Install the LTS version from https://nodejs.org and run this again.'
}
if (-not (Get-Command catalyst -ErrorAction SilentlyContinue)) {
  Write-Host 'Installing the Zoho Catalyst CLI...' -ForegroundColor Cyan
  npm install -g zcatalyst-cli
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

if ($Rebuild -or -not (Test-Path 'appsail\static\index.html')) {
  Write-Host 'Building the web app...' -ForegroundColor Cyan
  Push-Location ..
  npm ci
  npm run build
  Pop-Location
  if (Test-Path 'appsail\static') { Remove-Item -Recurse -Force 'appsail\static' }
  Copy-Item -Recurse '..\dist' 'appsail\static'
}

catalyst whoami *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Sign in to Zoho Catalyst in the browser window that opens...' -ForegroundColor Cyan
  catalyst login --dc in
}

Write-Host 'Pick your Catalyst project:' -ForegroundColor Cyan
catalyst project:use

# A CLI deploy replaces AppSail's environment variables with app-config.json's env_variables
# (Console-set values are wiped). So secrets live in microgrid\.env (git-ignored) and are merged
# into app-config.json only for the duration of the deploy.
$cfgPath = (Resolve-Path 'appsail\app-config.json').Path
$original = [IO.File]::ReadAllText($cfgPath)
try {
  if (Test-Path '.env') {
    $cfg = $original | ConvertFrom-Json
    $vars = @{}
    $cfg.env_variables.PSObject.Properties | ForEach-Object { $vars[$_.Name] = $_.Value }
    Get-Content '.env' | ForEach-Object {
      $line = $_.Trim()
      if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
        $k, $v = $line.Split('=', 2)
        if ($v.Trim()) { $vars[$k.Trim()] = $v.Trim() }
      }
    }
    $cfg.env_variables = [pscustomobject]$vars
    [IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json -Depth 5))  # UTF-8 without BOM
    Write-Host ("Using {0} environment variables from .env" -f $vars.Count) -ForegroundColor Cyan
  } else {
    Write-Host 'No microgrid\.env found: deploying without QuickML credentials (the app uses its built-in model).' -ForegroundColor Yellow
  }
  Write-Host 'Deploying AppSail "microgrid"...' -ForegroundColor Cyan
  catalyst deploy --only appsail:microgrid
} finally {
  [IO.File]::WriteAllText($cfgPath, $original)
}

Write-Host ''
Write-Host 'Done. Copy the AppSail URL printed above and open <URL>/#/grid to check it.' -ForegroundColor Green
