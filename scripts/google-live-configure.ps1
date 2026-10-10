param(
  [Parameter(Mandatory = $true)]
  [string]$ClientSecretJson,
  [string]$EnvPath = ".env.google.local",
  [string]$Port = "3001"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$envFile = if ([System.IO.Path]::IsPathRooted($EnvPath)) { $EnvPath } else { Join-Path $root $EnvPath }
$jsonPath = if ([System.IO.Path]::IsPathRooted($ClientSecretJson)) { $ClientSecretJson } else { Join-Path $root $ClientSecretJson }

if (-not (Test-Path $jsonPath)) {
  throw "No existe el archivo JSON: $jsonPath"
}

$payload = Get-Content -Raw -LiteralPath $jsonPath | ConvertFrom-Json
$client = $payload.web
if (-not $client) {
  throw "El JSON debe ser de tipo web OAuth client."
}
if (-not $client.client_id -or -not $client.client_secret) {
  throw "El JSON no contiene client_id o client_secret."
}

$redirectUri = "http://127.0.0.1:$Port/api/saas/google/oauth/callback"
$origin = "http://127.0.0.1:$Port"
$redirects = @($client.redirect_uris)
$origins = @($client.javascript_origins)

if ($redirects -notcontains $redirectUri) {
  throw "El JSON no contiene el redirect esperado: $redirectUri"
}
if ($origins -notcontains $origin) {
  throw "El JSON no contiene el origen esperado: $origin"
}

$existing = @{}
if (Test-Path $envFile) {
  foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $key, $value = $line -split '=', 2
    $existing[$key.Trim()] = $value
  }
}

$secretKey = $existing["SECRET_ENCRYPTION_KEY"]
if (-not $secretKey) {
  $bytes = [byte[]]::new(32)
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  $secretKey = [Convert]::ToBase64String($bytes)
}

$lines = @(
  "# Local Google OAuth pilot config. Do not commit.",
  "GOOGLE_CLIENT_ID=$($client.client_id)",
  "GOOGLE_CLIENT_SECRET=$($client.client_secret)",
  "GOOGLE_REDIRECT_URI=$redirectUri",
  "SECRET_ENCRYPTION_KEY=$secretKey",
  "HOST=127.0.0.1",
  "PORT=$Port",
  "PUBLIC_APP_URL=$origin",
  "STORAGE_DRIVER=postgres",
  "DATABASE_URL=postgres://usrventas:usrventas@127.0.0.1:5432/ventas_ia_dev",
  "DATABASE_SSL=disable"
)

[System.IO.File]::WriteAllLines($envFile, $lines, [System.Text.UTF8Encoding]::new($false))
Write-Host "Configuracion local creada: $envFile"
Write-Host "Client ID: $($client.client_id)"
Write-Host "Redirect URI: $redirectUri"
