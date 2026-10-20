[CmdletBinding()]
param(
  [string]$ConfigFile
)

if (-not $ConfigFile) {
  $ConfigFile = Join-Path $PSScriptRoot '..\.env.example'
}

$databaseLine = Get-Content -LiteralPath $ConfigFile |
  Where-Object { $_ -match '^DATABASE_URL=' } |
  Select-Object -First 1

if (-not $databaseLine) {
  throw "DATABASE_URL no esta definida en $ConfigFile"
}

$databaseUrl = $databaseLine.Substring('DATABASE_URL='.Length)
$uri = [Uri]$databaseUrl
$databaseName = $uri.AbsolutePath.Trim('/')

if ($uri.Host -notin @('127.0.0.1', 'localhost') -or $databaseName -ne 'ventas_ia_dev') {
  throw "La prueba PostgreSQL local solo admite 127.0.0.1/ventas_ia_dev; se recibio $($uri.Host)/$databaseName"
}

$env:POSTGRES_TEST_DATABASE_URL = $databaseUrl
$env:DATABASE_SSL = 'disable'

& node server/tests/postgres-smoke.mjs
exit $LASTEXITCODE
