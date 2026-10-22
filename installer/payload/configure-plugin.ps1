# configure-plugin.ps1
#
# Creates or updates the single runtime state for a YouTubePanel install:
#
#   {app}\config.json                    port, token and sidecar settings
#   %APPDATA%\BetterDiscord\plugins\YouTubePanel.config.json
#                                         sidecarUrl and sidecarToken settings
#
# The port is chosen by bind-testing 127.0.0.1:8910-8999. The plugin always
# receives the exact port and token written to config.json, and all JSON writes
# are atomic (temp file + replace) so a crashed setup cannot leave a truncated
# config behind.
#
# Existing settings are preserved. The plugin config is backed up to
# YouTubePanel.config.json.bak before it is rewritten.

param(
  [string]$PluginDir = (Join-Path $env:APPDATA "BetterDiscord\plugins"),
  [string]$SidecarConfig = "",
  [string]$SidecarUrl = "",
  [string]$SidecarToken = "",
  [int]$Port = 0,
  [switch]$ResetPort,
  [switch]$RequirePlugin
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$commonPath = Join-Path $PSScriptRoot "panel-common.ps1"
if (-not (Test-Path -LiteralPath $commonPath)) {
  throw "panel-common.ps1 is missing next to configure-plugin.ps1."
}
. $commonPath

$errors = New-Object System.Collections.ArrayList
$warnings = New-Object System.Collections.ArrayList

if ([string]::IsNullOrWhiteSpace($SidecarConfig)) {
  $SidecarConfig = Join-Path $PSScriptRoot "config.json"
}
if ([string]::IsNullOrWhiteSpace($PluginDir)) {
  $PluginDir = Join-Path $env:APPDATA "BetterDiscord\plugins"
}
if (-not (Test-Path -LiteralPath $PluginDir -PathType Container)) {
  throw "BetterDiscord plugins folder was not found: $PluginDir"
}

# --------------------------------------------------------------- sidecar config
$config = Panel-GetConfig -Path $SidecarConfig
$previousPort = Panel-GetPort -Config $config
$existingToken = Panel-GetToken -Config $config

$token = $existingToken
if (-not [string]::IsNullOrWhiteSpace($SidecarToken)) { $token = $SidecarToken }

$requestedPort = $Port
if ($requestedPort -le 0 -and -not [string]::IsNullOrWhiteSpace($SidecarUrl)) {
  try {
    $uri = [uri]$SidecarUrl
    if ($uri.Port -gt 0) { $requestedPort = [int]$uri.Port }
  }
  catch { }
}

$chosenPort = Panel-SelectPort -Preferred $requestedPort -Previous $previousPort -ForceNew:$ResetPort
if ($chosenPort -le 0) {
  throw "No free local port was found in 8910-8999. Close the program using those ports and run setup again."
}

$config | Add-Member -NotePropertyName port -NotePropertyValue $chosenPort -Force
$config | Add-Member -NotePropertyName token -NotePropertyValue $token -Force
Panel-WriteJsonAtomic -Path $SidecarConfig -Object $config

# Re-read from disk so the plugin is only ever pointed at persisted state.
$persisted = Panel-GetConfig -Path $SidecarConfig
$chosenPort = Panel-GetPort -Config $persisted
$token = Panel-GetToken -Config $persisted
if ($chosenPort -le 0) {
  throw "config.json was written without a usable port."
}
if ([string]::IsNullOrWhiteSpace($SidecarUrl)) {
  $SidecarUrl = "http://127.0.0.1:" + $chosenPort
}

# ---------------------------------------------------------------- plugin config
$pluginConfigPath = Join-Path $PluginDir "YouTubePanel.config.json"
$pluginConfig = $null
if (Test-Path -LiteralPath $pluginConfigPath) {
  $pluginConfig = Panel-ReadJson -Path $pluginConfigPath
  try {
    Copy-Item -LiteralPath $pluginConfigPath -Destination ($pluginConfigPath + ".bak") -Force
  }
  catch {
    [void]$warnings.Add("Could not back up " + $pluginConfigPath + ": " + $_.Exception.Message)
  }
  if ($null -eq $pluginConfig) {
    [void]$warnings.Add("Existing plugin config was unreadable and was replaced.")
  }
}

if ($null -eq $pluginConfig) {
  $pluginConfig = [pscustomobject]@{ settings = [pscustomobject]@{} }
}
if (-not ($pluginConfig.PSObject.Properties.Name -contains "settings") -or $null -eq $pluginConfig.settings) {
  $pluginConfig | Add-Member -NotePropertyName settings -NotePropertyValue ([pscustomobject]@{}) -Force
}

$settings = $pluginConfig.settings
# Legacy keys that pointed at removed features. They are not user settings.
$settings.PSObject.Properties.Remove("youtubeCookie")
$settings.PSObject.Properties.Remove("audioSource")
$settings | Add-Member -NotePropertyName sidecarUrl -NotePropertyValue $SidecarUrl -Force
$settings | Add-Member -NotePropertyName sidecarToken -NotePropertyValue $token -Force

Panel-WriteJsonAtomic -Path $pluginConfigPath -Object $pluginConfig

# --------------------------------------------------------- plugin file validation
$pluginPath = Join-Path $PluginDir "YouTubePanel.plugin.js"
$pluginInfo = [pscustomobject]@{
  path    = $pluginPath
  exists  = (Test-Path -LiteralPath $pluginPath -PathType Leaf)
  version = ""
  valid   = $false
  error   = ""
}

function Read-TextShared {
  param([string]$Path)
  $stream = $null
  $reader = $null
  try {
    # FileShare.ReadWrite: BetterDiscord can keep the plugin open.
    $stream = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8, $true)
    return $reader.ReadToEnd()
  }
  finally {
    if ($null -ne $reader) { try { $reader.Dispose() } catch { } }
    if ($null -ne $stream) { try { $stream.Dispose() } catch { } }
  }
}

if ($pluginInfo.exists) {
  try {
    $text = Read-TextShared -Path $pluginPath
    $head = ($text -split "`n" | Select-Object -First 60) -join "`n"
    $nameMatch = [regex]::Match($head, '(?im)^\s*\*\s*@name\s+(.+?)\s*$')
    $versionMatch = [regex]::Match($head, '(?im)^\s*\*\s*@version\s+(\S+)\s*$')
    if ($versionMatch.Success) { $pluginInfo.version = $versionMatch.Groups[1].Value.Trim() }
    if (-not $nameMatch.Success -or $nameMatch.Groups[1].Value.Trim() -notmatch '(?i)YouTubePanel') {
      $pluginInfo.error = "plugin header does not declare @name YouTubePanel"
    }
    elseif ([string]::IsNullOrWhiteSpace($pluginInfo.version)) {
      $pluginInfo.error = "plugin header has no @version"
    }
    else {
      $pluginInfo.valid = $true
    }
  }
  catch {
    $pluginInfo.error = "plugin file is locked or unreadable: " + $_.Exception.Message
  }
}
else {
  $pluginInfo.error = "plugin file was not copied"
}

if (-not $pluginInfo.valid) {
  if ($RequirePlugin) {
    [void]$errors.Add($pluginInfo.error)
  }
  else {
    [void]$warnings.Add($pluginInfo.error)
  }
}

# ------------------------------------------------- BetterDiscord data branches
$dataRoot = Join-Path $env:APPDATA "BetterDiscord\data"
$pluginStateFiles = New-Object System.Collections.ArrayList
if (Test-Path -LiteralPath $dataRoot -PathType Container) {
  $stateFiles = New-Object System.Collections.ArrayList
  $rootState = Join-Path $dataRoot "plugins.json"
  if (Test-Path -LiteralPath $rootState -PathType Leaf) { [void]$stateFiles.Add($rootState) }
  try {
    foreach ($file in @(Get-ChildItem -LiteralPath $dataRoot -Recurse -Depth 2 -Filter "plugins.json" -File -ErrorAction SilentlyContinue)) {
      [void]$stateFiles.Add($file.FullName)
    }
  }
  catch { }
  foreach ($statePath in $stateFiles) {
    try {
      $state = Panel-ReadJson -Path $statePath
      if ($null -eq $state) { continue }
      if (-not (Test-Path -LiteralPath ($statePath + ".bak"))) {
        try { Copy-Item -LiteralPath $statePath -Destination ($statePath + ".bak") -Force } catch { }
      }
      $state | Add-Member -NotePropertyName YouTubePanel -NotePropertyValue $true -Force
      Panel-WriteJsonAtomic -Path $statePath -Object $state
      [void]$pluginStateFiles.Add($statePath)
    }
    catch {
      [void]$warnings.Add("Could not update " + $statePath + ": " + $_.Exception.Message)
    }
  }
}
else {
  [void]$warnings.Add("BetterDiscord data folder was not found: " + $dataRoot)
}

# ---------------------------------------------------------------- report
$reportPath = Join-Path (Split-Path -Parent $SidecarConfig) "configure-report.json"
$report = [pscustomobject]@{
  updatedAt      = (Get-Date).ToString("o")
  configPath     = $SidecarConfig
  pluginConfig   = $pluginConfigPath
  pluginFile     = $pluginPath
  pluginVersion  = $pluginInfo.version
  pluginValid    = $pluginInfo.valid
  pluginError    = $pluginInfo.error
  port           = $chosenPort
  sidecarUrl     = $SidecarUrl
  pluginState    = @($pluginStateFiles)
  errors         = @($errors)
  warnings       = @($warnings)
}
Panel-WriteJsonAtomic -Path $reportPath -Object $report

# Seed the installer-facing report so diagnostics exist even if a later step
# (sidecar start, healthcheck) never runs.
$installReportPath = Join-Path (Split-Path -Parent $SidecarConfig) "install-report.json"
try {
  $null = Panel-MergeReport -Path $installReportPath -Values @{
    version         = $pluginInfo.version
    installPath     = (Split-Path -Parent $SidecarConfig)
    configPath      = $SidecarConfig
    chosenPort      = $chosenPort
    sidecarUrl      = $SidecarUrl
    pluginPath      = $pluginPath
    localSelftest   = [pscustomobject]@{ status = "not-run"; mode = ""; error = ""; details = "" }
    networkSelftest = [pscustomobject]@{ status = "skipped"; error = ""; video = "" }
    playback        = "unverified"
    plugin          = $report
    errors          = @($errors)
    warnings        = @($warnings)
    updatedAt       = (Get-Date).ToString("o")
  }
}
catch { }

Write-Host ("YouTubePanel configured: port=" + $chosenPort + " pluginVersion=" + $pluginInfo.version)
foreach ($warning in $warnings) { Write-Host ("WARN: " + $warning) }
foreach ($errorText in $errors) { Write-Host ("ERROR: " + $errorText) }

if ($errors.Count -gt 0) { exit 1 }
exit 0
