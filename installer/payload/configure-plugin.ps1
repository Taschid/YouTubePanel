param(
  [string]$PluginDir = (Join-Path $env:APPDATA "BetterDiscord\plugins"),
  [string]$SidecarUrl = "http://127.0.0.1:8910",
  [string]$SidecarToken = "youtube-panel"
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $PluginDir)) {
  throw "BetterDiscord plugins folder was not found: $PluginDir"
}

$configPath = Join-Path $PluginDir "YouTubePanel.config.json"
$config = $null
if (Test-Path $configPath) {
  try {
    $config = Get-Content $configPath -Raw | ConvertFrom-Json
  }
  catch {
    Copy-Item $configPath ($configPath + ".bak") -Force
    $config = $null
  }
}

if ($null -eq $config) {
  $config = [pscustomobject]@{ settings = [pscustomobject]@{} }
}
if ($null -eq $config.settings) {
  $config | Add-Member -NotePropertyName settings -NotePropertyValue ([pscustomobject]@{}) -Force
}

$settings = $config.settings
$settings.PSObject.Properties.Remove("youtubeCookie")
$settings.PSObject.Properties.Remove("audioSource")
$settings | Add-Member -NotePropertyName sidecarUrl -NotePropertyValue $SidecarUrl -Force
$settings | Add-Member -NotePropertyName sidecarToken -NotePropertyValue $SidecarToken -Force

$json = $config | ConvertTo-Json -Depth 20
[IO.File]::WriteAllText($configPath, $json, (New-Object System.Text.UTF8Encoding($false)))
