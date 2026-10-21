[CmdletBinding()]
param(
  [string]$SourceDatabaseUrl = $(if ($env:E2E_SOURCE_DATABASE_URL) { $env:E2E_SOURCE_DATABASE_URL } else { $env:DATABASE_URL }),
  [string]$RunId = $env:E2E_RUN_ID,
  [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
if (-not $OutputDirectory) {
  $repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
  $OutputDirectory = Join-Path $repositoryRoot 'tmp\e2e\postgres'
}

function Get-PgBin {
  if ($env:PG_BIN) {
    if (-not (Test-Path (Join-Path $env:PG_BIN 'pg_dump.exe'))) { throw "PG_BIN no contiene pg_dump.exe" }
    return $env:PG_BIN
  }
  $fromPath = Get-Command pg_dump.exe -ErrorAction SilentlyContinue
  if ($fromPath) { return Split-Path -Parent $fromPath.Source }
  $candidates = @(Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName 'bin' } |
    Where-Object { Test-Path (Join-Path $_ 'pg_dump.exe') })
  if ($candidates) { return $candidates[0] }
  throw 'No se encontraron pg_dump, pg_restore y createdb. Defina PG_BIN o instale las herramientas PostgreSQL locales.'
}

function Assert-LoopbackUri([Uri]$Uri, [string]$Label) {
  if ($Uri.Scheme -notin @('postgres', 'postgresql')) { throw "$Label debe usar postgres:// o postgresql://" }
  if ($Uri.Host -notin @('127.0.0.1', 'localhost', '::1')) { throw "$Label debe apuntar a loopback, no a $($Uri.Host)" }
  $database = $Uri.AbsolutePath.Trim('/')
  if (-not $database) { throw "$Label debe incluir una base de datos" }
  return $database
}

function Get-UrlWithoutPassword([Uri]$Uri, [string]$DatabaseName) {
  $builder = [System.UriBuilder]::new($Uri)
  $builder.Password = ''
  $builder.Path = "/$DatabaseName"
  return $builder.Uri.AbsoluteUri.TrimEnd('/')
}

if (-not $SourceDatabaseUrl) { throw 'E2E_SOURCE_DATABASE_URL es obligatoria.' }
if (-not $RunId) { $RunId = (Get-Date -Format 'yyyyMMddHHmmss') + '-' + ([Guid]::NewGuid().ToString('N').Substring(0, 8)) }
$RunId = $RunId.ToLowerInvariant().Replace('-', '_')
if ($RunId -notmatch '^[a-z0-9_]+$') { throw 'RunId solo puede contener letras minusculas, numeros y guion bajo.' }

$sourceUri = [Uri]$SourceDatabaseUrl
$sourceDatabase = Assert-LoopbackUri $sourceUri 'La fuente'
if ($sourceDatabase -like 'ventas_ia_e2e_*') { throw 'La fuente no puede ser un clon E2E.' }
$targetDatabase = "ventas_ia_e2e_$RunId"
if ($targetDatabase -eq $sourceDatabase) { throw 'El destino no puede ser igual a la fuente.' }

$pgBin = Get-PgBin
$sourcePort = if ($sourceUri.Port -gt 0) { $sourceUri.Port } else { 5432 }
foreach ($command in @('pg_dump.exe', 'pg_restore.exe', 'createdb.exe', 'dropdb.exe')) {
  if (-not (Test-Path (Join-Path $pgBin $command))) { throw "Falta $command en $pgBin" }
}

$userInfo = $sourceUri.UserInfo.Split(':', 2)
$username = [Uri]::UnescapeDataString($userInfo[0])
$password = if ($userInfo.Length -gt 1) { [Uri]::UnescapeDataString($userInfo[1]) } else { '' }
if (-not $username) { throw 'La URL fuente debe incluir usuario PostgreSQL.' }

$runDirectory = Join-Path $OutputDirectory $RunId
New-Item -ItemType Directory -Force -Path $runDirectory | Out-Null
$dumpPath = Join-Path $runDirectory 'baseline.dump'
$sourceSafeUrl = Get-UrlWithoutPassword $sourceUri $sourceDatabase
$targetSafeUrl = Get-UrlWithoutPassword $sourceUri $targetDatabase
$previousPassword = $env:PGPASSWORD

try {
  $env:PGPASSWORD = $password
  & (Join-Path $pgBin 'pg_dump.exe') --format=custom --no-owner --no-privileges --file $dumpPath --dbname $sourceSafeUrl
  if ($LASTEXITCODE -ne 0) { throw "pg_dump fallo con codigo $LASTEXITCODE" }

  & (Join-Path $pgBin 'createdb.exe') --host $sourceUri.Host --port $sourcePort --username $username $targetDatabase
  if ($LASTEXITCODE -ne 0) { throw "createdb fallo con codigo $LASTEXITCODE" }

  & (Join-Path $pgBin 'pg_restore.exe') --exit-on-error --no-owner --no-privileges --dbname $targetSafeUrl $dumpPath
  if ($LASTEXITCODE -ne 0) {
    & (Join-Path $pgBin 'dropdb.exe') --if-exists --host $sourceUri.Host --port $sourcePort --username $username $targetDatabase
    throw "pg_restore fallo con codigo $LASTEXITCODE"
  }
} finally {
  if ($null -eq $previousPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
  else { $env:PGPASSWORD = $previousPassword }
}

$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
  $hash = ([BitConverter]::ToString($sha256.ComputeHash([System.IO.File]::ReadAllBytes($dumpPath)))).Replace('-', '').ToLowerInvariant()
} finally {
  $sha256.Dispose()
}
@{
  sourceDatabase = $sourceDatabase
  targetDatabase = $targetDatabase
  targetDatabaseUrl = $targetSafeUrl
  dumpPath = $dumpPath
  dumpSha256 = $hash
  pgBin = $pgBin
} | ConvertTo-Json -Compress
