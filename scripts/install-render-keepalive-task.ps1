[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Url,
  [string]$TaskName = 'Ventas IA - Render Keep Alive',
  [ValidateRange(5, 14)]
  [int]$IntervalMinutes = 10
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$keepAliveScript = Join-Path $PSScriptRoot 'render-keepalive.mjs'
$node = (Get-Command node.exe -ErrorAction Stop).Source

$action = New-ScheduledTaskAction `
  -Execute $node `
  -Argument "`"$keepAliveScript`" --url `"$Url`"" `
  -WorkingDirectory $projectRoot

$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Mantiene activo el Web Service de Render consultando su endpoint de salud." `
  -Force | Out-Null

Write-Output "Tarea '$TaskName' instalada. URL: $Url. Intervalo: $IntervalMinutes minutos."
