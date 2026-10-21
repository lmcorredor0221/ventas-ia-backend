[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DatabaseUrl
)

$ErrorActionPreference = 'Stop'
if ($env:E2E_DROP_CLONE -ne 'true') { throw 'Defina E2E_DROP_CLONE=true para borrar un clon E2E.' }
$uri = [Uri]$DatabaseUrl
$database = $uri.AbsolutePath.Trim('/')
if ($uri.Host -notin @('127.0.0.1', 'localhost', '::1')) { throw 'Solo se pueden borrar clones en loopback.' }
if ($database -notmatch '^ventas_ia_e2e_[a-z0-9_]+$') { throw 'El nombre no corresponde a un clon ventas_ia_e2e_<runId>.' }

$pgBin = if ($env:PG_BIN) { $env:PG_BIN } else {
  (Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName 'bin' } |
    Where-Object { Test-Path (Join-Path $_ 'dropdb.exe') } |
    Select-Object -First 1)
}
if (-not $pgBin) { throw 'No se encontro dropdb.exe. Defina PG_BIN.' }
$parts = $uri.UserInfo.Split(':', 2)
$port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
$env:PGPASSWORD = if ($parts.Length -gt 1) { [Uri]::UnescapeDataString($parts[1]) } else { '' }
try {
  & (Join-Path $pgBin 'dropdb.exe') --if-exists --host $uri.Host --port $port --username ([Uri]::UnescapeDataString($parts[0])) $database
  if ($LASTEXITCODE -ne 0) { throw "dropdb fallo con codigo $LASTEXITCODE" }
} finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
