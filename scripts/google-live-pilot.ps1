param(
  [string]$OwnerEmail = "lmcorredor@gmail.com",
  [string]$StoreName = "Tienda Piloto Google",
  [string]$Port = "3001",
  [string]$EnvPath = ".env.google.local",
  [switch]$UseCodexCliSimulator
)

$ErrorActionPreference = "Stop"

function Require-Env($Name) {
  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not $value) {
    $value = [Environment]::GetEnvironmentVariable($Name, "User")
  }
  if (-not $value) {
    throw "Falta variable requerida: $Name"
  }
  return $value
}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Load-EnvFile($Path) {
  $resolved = if ([System.IO.Path]::IsPathRooted($Path)) { $Path } else { Join-Path $root $Path }
  if (-not (Test-Path $resolved)) { return }
  foreach ($line in Get-Content -LiteralPath $resolved) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $key, $value = $line -split '=', 2
    if ($key) {
      [Environment]::SetEnvironmentVariable($key.Trim(), $value, "Process")
    }
  }
}

Load-EnvFile $EnvPath

Require-Env "GOOGLE_CLIENT_ID" | Out-Null
Require-Env "GOOGLE_CLIENT_SECRET" | Out-Null
Require-Env "SECRET_ENCRYPTION_KEY" | Out-Null

$env:HOST = "127.0.0.1"
$env:PORT = $Port
$env:PUBLIC_APP_URL = "http://127.0.0.1:$Port"
$env:GOOGLE_REDIRECT_URI = "http://127.0.0.1:$Port/api/saas/google/oauth/callback"
$env:AUTH_REQUIRED = "true"
$env:CSRF_REQUIRED = "true"
$env:ALLOW_DEV_GOOGLE_LOGIN = "false"
if (-not $env:VITE_GOOGLE_CLIENT_ID) { $env:VITE_GOOGLE_CLIENT_ID = $env:GOOGLE_CLIENT_ID }
if (-not $env:STORAGE_DRIVER) { $env:STORAGE_DRIVER = "postgres" }
if (-not $env:DATABASE_URL) { $env:DATABASE_URL = "postgres://usrventas:usrventas@127.0.0.1:5432/ventas_ia_dev" }
if (-not $env:DATABASE_SSL) { $env:DATABASE_SSL = "disable" }
if ($UseCodexCliSimulator) {
  $env:LLM_SIMULATOR = "codex_cli"
  if (-not $env:CODEX_CLI_MODEL) { $env:CODEX_CLI_MODEL = "gpt-6-luna" }
}

Write-Host "Iniciando backend piloto Google live en $env:PUBLIC_APP_URL"
Write-Host "Cuenta sugerida para OAuth: $OwnerEmail"
Write-Host "Redirect URI esperado en Google Cloud: $env:GOOGLE_REDIRECT_URI"
if ($env:LLM_SIMULATOR) { Write-Host "Simulador LLM local: $env:LLM_SIMULATOR" }
if ($env:CODEX_CLI_MODEL) { Write-Host "Modelo Codex CLI: $env:CODEX_CLI_MODEL" }

npm run backend
