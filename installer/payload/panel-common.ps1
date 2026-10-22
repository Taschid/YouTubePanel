# panel-common.ps1
#
# Shared helpers for the YouTubePanel installer payload. Dot-source this file:
#
#   . (Join-Path $PSScriptRoot "panel-common.ps1")
#
# Everything here is Windows PowerShell 5.1 compatible and never touches the
# persistent user or machine PATH.

$script:PanelConfigDefaults = [ordered]@{
  port        = 8910
  token       = "youtube-panel"
  mpvPath     = "bin\mpv.exe"
  ytdlpPath   = "bin\yt-dlp.exe"
  volume      = 70
  searchLimit = 15
}

$script:PanelPortRangeStart = 8910
$script:PanelPortRangeEnd   = 8999

function Panel-GetConfigPath {
  param([string]$InstallDir = $PSScriptRoot)
  return (Join-Path $InstallDir "config.json")
}

function Panel-ReadJson {
  param([string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  try {
    return (Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json)
  }
  catch {
    return $null
  }
}

function Panel-WriteJsonAtomic {
  param(
    [string]$Path,
    $Object
  )
  $dir = Split-Path -Parent $Path
  if ([string]::IsNullOrWhiteSpace($dir)) { $dir = "." }
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }

  $json = $Object | ConvertTo-Json -Depth 20
  $encoding = New-Object System.Text.UTF8Encoding($false)
  $bytes = $encoding.GetBytes($json)
  $temp = Join-Path $dir ("." + [System.IO.Path]::GetFileName($Path) + "." + $PID + "." + [guid]::NewGuid().ToString("N").Substring(0, 8) + ".tmp")

  [System.IO.File]::WriteAllBytes($temp, $bytes)
  try {
    if (Test-Path -LiteralPath $Path) {
      try {
        [System.IO.File]::Replace($temp, $Path, $null)
        return
      }
      catch {
        Move-Item -LiteralPath $temp -Destination $Path -Force
        return
      }
    }
    Move-Item -LiteralPath $temp -Destination $Path -Force
  }
  finally {
    if (Test-Path -LiteralPath $temp) {
      Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
    }
  }
}

function Panel-GetConfig {
  param(
    [string]$Path,
    [switch]$Create
  )
  $config = Panel-ReadJson -Path $Path
  $needsWrite = $false
  if ($null -eq $config) {
    $config = [pscustomobject]@{}
    $needsWrite = $true
  }
  foreach ($key in $script:PanelConfigDefaults.Keys) {
    if (-not ($config.PSObject.Properties.Name -contains $key)) {
      $defaultValue = $script:PanelConfigDefaults[$key]
      $config | Add-Member -NotePropertyName $key -NotePropertyValue $defaultValue -Force
      $needsWrite = $true
    }
  }
  if ($Create -and $needsWrite) {
    Panel-WriteJsonAtomic -Path $Path -Object $config
  }
  return $config
}

function Panel-GetPort {
  param($Config)
  if ($null -eq $Config) { return 0 }
  if (-not ($Config.PSObject.Properties.Name -contains "port")) { return 0 }
  $value = 0
  [void][int]::TryParse([string]$Config.port, [ref]$value)
  return $value
}

function Panel-GetToken {
  param($Config)
  if ($null -eq $Config) { return $script:PanelConfigDefaults["token"] }
  if (-not ($Config.PSObject.Properties.Name -contains "token")) { return $script:PanelConfigDefaults["token"] }
  $value = [string]$Config.token
  if ([string]::IsNullOrWhiteSpace($value)) { return $script:PanelConfigDefaults["token"] }
  return $value
}

function Panel-TestPortFree {
  param([int]$Port)
  if ($Port -le 0 -or $Port -gt 65535) { return $false }
  $listener = $null
  try {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
    $listener.Start()
    return $true
  }
  catch {
    return $false
  }
  finally {
    if ($null -ne $listener) {
      try { $listener.Stop() } catch { }
    }
  }
}

function Panel-FindFreePort {
  param(
    [int]$Start = $script:PanelPortRangeStart,
    [int]$End = $script:PanelPortRangeEnd,
    [int[]]$Exclude = @()
  )
  for ($candidate = $Start; $candidate -le $End; $candidate++) {
    if ($Exclude -contains $candidate) { continue }
    if (Panel-TestPortFree -Port $candidate) { return $candidate }
  }
  return 0
}

function Panel-SelectPort {
  param(
    [int]$Preferred = 0,
    [int]$Previous = 0,
    [switch]$ForceNew
  )

  if (-not $ForceNew) {
    if ($Preferred -gt 0 -and (Panel-TestPortFree -Port $Preferred)) { return $Preferred }
    if ($Previous -gt 0 -and $Previous -ne $Preferred -and (Panel-TestPortFree -Port $Previous)) { return $Previous }
  }

  $exclude = @()
  if ($Previous -gt 0) { $exclude += $Previous }
  if ($Preferred -gt 0) { $exclude += $Preferred }
  return (Panel-FindFreePort -Exclude $exclude)
}

function Panel-GetPortOwner {
  param([int]$Port)
  if ($Port -le 0) { return 0 }
  try {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
      Select-Object -First 1
    if ($connection -and $connection.OwningProcess) { return [int]$connection.OwningProcess }
  }
  catch { }
  try {
    $pattern = ":" + $Port + "\s+\S+\s+LISTENING\s+(\d+)"
    foreach ($line in @(netstat -ano -p tcp)) {
      if ([string]$line -match $pattern) { return [int]$Matches[1] }
    }
  }
  catch { }
  return 0
}

function Panel-GetProcessCommandLine {
  param([int]$ProcessId)
  if ($ProcessId -le 0) { return "" }
  try {
    $process = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $ProcessId) -ErrorAction Stop
    if ($process) { return [string]$process.CommandLine }
  }
  catch { }
  return ""
}

function Panel-TestSidecarProcess {
  param([int]$ProcessId)
  if ($ProcessId -le 0) { return $false }
  if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return $false }
  $commandLine = Panel-GetProcessCommandLine -ProcessId $ProcessId
  return ($commandLine -match '(?i)sidecar\.js')
}

function Panel-MergeReport {
  param(
    [string]$Path,
    [hashtable]$Values
  )
  $report = Panel-ReadJson -Path $Path
  if ($null -eq $report) { $report = [pscustomobject]@{} }
  foreach ($key in $Values.Keys) {
    $report | Add-Member -NotePropertyName $key -NotePropertyValue $Values[$key] -Force
  }
  Panel-WriteJsonAtomic -Path $Path -Object $report
  return $report
}

function Panel-GetInstallRoots {
  param(
    [string]$InstallDir,
    [string[]]$ExtraRoots = @()
  )
  $roots = New-Object System.Collections.ArrayList
  $candidates = New-Object System.Collections.ArrayList
  [void]$candidates.Add($InstallDir)
  if ($env:LOCALAPPDATA) { [void]$candidates.Add((Join-Path $env:LOCALAPPDATA "YouTubePanel")) }
  if ($env:PUBLIC) { [void]$candidates.Add((Join-Path $env:PUBLIC "YouTubePanel")) }
  foreach ($extra in $ExtraRoots) { [void]$candidates.Add($extra) }

  foreach ($candidate in $candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
    $full = $candidate
    try { $full = [System.IO.Path]::GetFullPath($candidate) } catch { }
    $full = $full.TrimEnd('\')
    $duplicate = $false
    foreach ($existing in $roots) {
      if ([string]::Equals([string]$existing, $full, [System.StringComparison]::OrdinalIgnoreCase)) {
        $duplicate = $true
        break
      }
    }
    if (-not $duplicate) { [void]$roots.Add($full) }
  }
  return $roots
}
