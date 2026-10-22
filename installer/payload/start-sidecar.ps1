# start-sidecar.ps1
#
# Build a safe PATH for the YouTubePanel sidecar, then start node.exe hidden and
# verify that it owns the configured local port.
#
# Windows error 448 ("The path cannot be traversed because it contains an
# untrusted mount point") happens when a process walks a PATH directory that is
# a junction/reparse point into a location it cannot trust. yt-dlp probes every
# PATH entry looking for ffmpeg, so a single bad entry makes /play fail while
# /search still works.
#
# This script runs on every launch. It recomposes PATH from the Machine and
# User PATH values, prepends the bundled bin folder, keeps only entries that
# Get-Item can stat and that are not reparse points, and optionally adds a
# safely resolved ffmpeg directory. The persistent User PATH is never changed.
#
# The port comes from config.json. If the sidecar cannot bind, or the new PID
# does not own the configured port, one retry is made with the next free port
# in 8910-8999. config.json and the BetterDiscord plugin config are updated
# atomically so both always point at the same port.

param(
  [string]$InstallDir = $PSScriptRoot,
  [switch]$NoRetry,
  [int]$ReadySeconds = 10
)

$ErrorActionPreference = "Stop"

$base = $InstallDir
if ([string]::IsNullOrWhiteSpace($base)) { $base = $PSScriptRoot }
try { $base = (Get-Item -LiteralPath $base -Force -ErrorAction Stop).FullName } catch { }

$commonPath = Join-Path $base "panel-common.ps1"
if (-not (Test-Path -LiteralPath $commonPath -PathType Leaf)) {
  # Without the shared helper the launcher cannot resolve the configured port.
  # Fall back to the old behaviour of letting sidecar.js read config.json.
  $commonPath = $null
}
if ($commonPath) { . $commonPath }

$launchLog = Join-Path $base "sidecar-launch.log"
$configPath = Join-Path $base "config.json"
$log = New-Object System.Collections.ArrayList

function Add-Log {
  param([string]$Text)
  [void]$log.Add([string]$Text)
}

function Get-BriefError {
  param($Exception)
  if ($null -eq $Exception) { return "unknown error" }
  $name = $Exception.GetType().Name
  $message = [string]$Exception.Message
  if ($message.Length -gt 300) { $message = $message.Substring(0, 300) + "..." }
  return ($name + ": " + $message)
}

function Write-LaunchLog {
  param([string]$Header)
  try {
    Set-Content -LiteralPath $launchLog -Value (@($Header) + $log) -Encoding UTF8 -ErrorAction SilentlyContinue
  }
  catch { }
}

function Get-RegistryPath {
  param([string]$Key)
  try {
    $value = (Get-ItemProperty -Path $Key -Name "Path" -ErrorAction Stop).Path
    if ($null -eq $value) { return "" }
    if ($value -is [array]) { return ($value -join ";") }
    return [string]$value
  }
  catch {
    Add-Log ("WARN: could not read " + $Key + "\Path: " + (Get-BriefError $_.Exception))
    return ""
  }
}

$machinePath = Get-RegistryPath "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment"
$userPath = Get-RegistryPath "HKCU:\Environment"

# base\bin first (mpv/yt-dlp), then Machine PATH, then User PATH.
$ordered = New-Object System.Collections.ArrayList
[void]$ordered.Add((Join-Path $base "bin"))
foreach ($entry in ($machinePath -split ";")) { [void]$ordered.Add($entry) }
foreach ($entry in ($userPath -split ";")) { [void]$ordered.Add($entry) }

$kept = New-Object System.Collections.ArrayList
$seen = @{}
$dropped = 0

foreach ($rawEntry in $ordered) {
  $entry = [string]$rawEntry
  if ([string]::IsNullOrWhiteSpace($entry)) { continue }
  $entry = $entry.Trim().Trim('"').Trim()
  if ($entry -eq "") { continue }

  $expanded = $entry
  try { $expanded = [System.Environment]::ExpandEnvironmentVariables($entry) } catch { }

  if (-not [System.IO.Path]::IsPathRooted($expanded)) {
    Add-Log ("DROP relative: " + $entry)
    $dropped++
    continue
  }

  $item = $null
  try {
    $item = Get-Item -LiteralPath $expanded -Force -ErrorAction Stop
  }
  catch {
    # Catches 448, access denied, missing paths, invalid characters, and any
    # other stat failure. The entry is dropped, never repaired.
    Add-Log ("DROP stat " + $expanded + " -> " + (Get-BriefError $_.Exception))
    $dropped++
    continue
  }

  if (-not $item.PSIsContainer) {
    Add-Log ("DROP not-a-directory: " + $expanded)
    $dropped++
    continue
  }

  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    Add-Log ("DROP reparse-point: " + $expanded)
    $dropped++
    continue
  }

  $full = [string]$item.FullName
  $key = $full.ToLowerInvariant()
  if ($seen.ContainsKey($key)) { continue }
  $seen[$key] = $true
  [void]$kept.Add($full)
}

# Defensive: the sidecar needs the system tools even if Machine PATH was
# unreadable. Only add it if it passes the same stat/reparse test.
$system32 = Join-Path $env:SystemRoot "System32"
if (-not $seen.ContainsKey($system32.ToLowerInvariant())) {
  try {
    $sysItem = Get-Item -LiteralPath $system32 -Force -ErrorAction Stop
    if ($sysItem.PSIsContainer -and (($sysItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0)) {
      [void]$kept.Add([string]$sysItem.FullName)
      $seen[$system32.ToLowerInvariant()] = $true
      Add-Log ("ADD system32 fallback: " + $system32)
    }
  }
  catch { }
}

# Resolve a usable ffmpeg directory. Prefer one already on PATH (it will have
# survived the filter), then bundled/common locations.
$ffmpegCandidates = New-Object System.Collections.ArrayList
foreach ($dir in $kept) { [void]$ffmpegCandidates.Add($dir) }
[void]$ffmpegCandidates.Add((Join-Path $base "runtime"))
$standardFfmpeg = @(
  (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links"),
  (Join-Path $env:ProgramFiles "ffmpeg\bin"),
  $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} "ffmpeg\bin" } else { "" })
)
foreach ($dir in $standardFfmpeg) { if (-not [string]::IsNullOrWhiteSpace($dir)) { [void]$ffmpegCandidates.Add($dir) } }

$ffmpegDir = $null
foreach ($candidate in $ffmpegCandidates) {
  if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
  $dirItem = $null
  try { $dirItem = Get-Item -LiteralPath $candidate -Force -ErrorAction Stop } catch { continue }
  if (-not $dirItem.PSIsContainer) { continue }
  if (($dirItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
  try {
    $exeItem = Get-Item -LiteralPath (Join-Path $dirItem.FullName "ffmpeg.exe") -Force -ErrorAction Stop
    if (-not $exeItem.PSIsContainer) { $ffmpegDir = [string]$dirItem.FullName; break }
  }
  catch { }
}

if ($ffmpegDir) {
  $key = $ffmpegDir.ToLowerInvariant()
  if (-not $seen.ContainsKey($key)) {
    [void]$kept.Add($ffmpegDir)
    $seen[$key] = $true
    Add-Log ("FFMPEG: " + $ffmpegDir)
  }
  else {
    Add-Log ("FFMPEG: already on PATH: " + $ffmpegDir)
  }
}
else {
  Add-Log "FFMPEG: none found (playback still works for formats that need no remux)"
}

$env:PATH = ($kept -join ";")
Add-Log ("PATH kept=" + $kept.Count + " dropped=" + $dropped)
Add-Log ("PATH=" + $env:PATH)

$header = "YouTubePanel sidecar launch " + (Get-Date).ToString("yyyy-MM-dd HH:mm:ss") + " (launcher pid " + $PID + ")"

$nodeExe = Join-Path $base "runtime\node.exe"
$sidecarJs = Join-Path $base "sidecar.js"

if (-not (Test-Path -LiteralPath $nodeExe -PathType Leaf)) {
  Add-Log ("FATAL: missing " + $nodeExe)
  Write-LaunchLog $header
  exit 1
}
if (-not (Test-Path -LiteralPath $sidecarJs -PathType Leaf)) {
  Add-Log ("FATAL: missing " + $sidecarJs)
  Write-LaunchLog $header
  exit 1
}

function Update-PluginPort {
  param([int]$Port)
  if (-not $commonPath) { return }
  $pluginDir = Join-Path $env:APPDATA "BetterDiscord\plugins"
  $configure = Join-Path $base "configure-plugin.ps1"
  if (-not (Test-Path -LiteralPath $configure -PathType Leaf)) { return }
  if (-not (Test-Path -LiteralPath $pluginDir -PathType Container)) { return }
  try {
    & $configure -PluginDir $pluginDir -SidecarConfig $configPath -Port $Port
    Add-Log ("PLUGIN: sidecarUrl updated to port " + $Port)
  }
  catch {
    Add-Log ("WARN: could not update plugin sidecarUrl: " + (Get-BriefError $_.Exception))
  }
}

# ----------------------------------------------------------- port resolution
$port = 0
$config = $null
if ($commonPath) {
  $config = Panel-GetConfig -Path $configPath -Create
  $port = Panel-GetPort -Config $config
  if ($port -le 0) {
    $port = Panel-SelectPort -Previous 0
    if ($port -le 0) {
      Add-Log "FATAL: no free port in 8910-8999"
      Write-LaunchLog $header
      exit 1
    }
    $config | Add-Member -NotePropertyName port -NotePropertyValue $port -Force
    Panel-WriteJsonAtomic -Path $configPath -Object $config
    Add-Log ("PORT: config had no port; selected " + $port)
  }
  elseif (-not (Panel-TestPortFree -Port $port)) {
    $owner = Panel-GetPortOwner -Port $port
    $ownerCommand = ""
    if ($owner -gt 0) { $ownerCommand = Panel-GetProcessCommandLine -ProcessId $owner }
    $ownerIsPanelSidecar = ($ownerCommand -match '(?i)sidecar\.js') -and
      (($ownerCommand -match [regex]::Escape($base)) -or ($ownerCommand -match '(?i)YouTubePanel'))

    if ($ownerIsPanelSidecar -and ($ownerCommand -match [regex]::Escape($base))) {
      # This exact install is already serving the configured port. Starting a
      # second copy would create two sidecars and two mpv processes.
      Add-Log ("ALREADY: pid " + $owner + " owns port " + $port + " for this install")
      Write-LaunchLog $header
      exit 0
    }

    if ($ownerIsPanelSidecar) {
      Add-Log ("STALE: stopping sidecar pid " + $owner + " from another install root on port " + $port)
      try { Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue } catch { }
      $freeDeadline = (Get-Date).AddSeconds(6)
      while ((Get-Date) -lt $freeDeadline) {
        if (Panel-TestPortFree -Port $port) { break }
        Start-Sleep -Milliseconds 250
      }
    }

    if (-not (Panel-TestPortFree -Port $port)) {
      $replacement = Panel-SelectPort -Previous $port -ForceNew
      if ($replacement -le 0) {
        Add-Log ("FATAL: configured port " + $port + " is busy and no free port exists in 8910-8999")
        Write-LaunchLog $header
        exit 1
      }
      Add-Log ("PORT: " + $port + " is busy; switching to " + $replacement)
      $port = $replacement
      $config | Add-Member -NotePropertyName port -NotePropertyValue $port -Force
      Panel-WriteJsonAtomic -Path $configPath -Object $config
      Update-PluginPort -Port $port
    }
  }
  Add-Log ("PORT: " + $port)
}
else {
  Add-Log "WARN: panel-common.ps1 missing; relying on sidecar.js config.json"
}

function Start-SidecarOnce {
  param([int]$Port)

  $arguments = @('"' + $sidecarJs + '"')
  if ($commonPath -and $Port -gt 0) {
    # sidecar.js reads config.json, but passing the port explicitly makes the
    # retry deterministic even if a write raced with a previous launch.
    $arguments += @("--port", [string]$Port)
  }

  $process = $null
  try {
    $process = Start-Process -FilePath $nodeExe -ArgumentList $arguments `
      -WorkingDirectory $base -WindowStyle Hidden -PassThru -ErrorAction Stop
  }
  catch {
    Add-Log ("FATAL: could not start node: " + (Get-BriefError $_.Exception))
    return $false
  }

  Add-Log ("STARTED: pid " + $process.Id + " " + $nodeExe + " " + $sidecarJs + " --port " + $Port)
  $deadline = (Get-Date).AddSeconds($ReadySeconds)
  while ((Get-Date) -lt $deadline) {
    if ($process.HasExited) {
      Add-Log ("FAIL: node exited with code " + $process.ExitCode + " before listening")
      return $false
    }
    $owner = Panel-GetPortOwner -Port $Port
    if ($owner -eq $process.Id) {
      Add-Log ("READY: pid " + $process.Id + " owns port " + $Port)
      return $true
    }
    Start-Sleep -Milliseconds 250
  }

  $owner = Panel-GetPortOwner -Port $Port
  Add-Log ("FAIL: pid " + $process.Id + " did not own port " + $Port + " within " + $ReadySeconds + " s (owner=" + $owner + ")")
  try { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } catch { }
  return $false
}

$started = Start-SidecarOnce -Port $port

if (-not $started -and -not $NoRetry -and $commonPath) {
  $replacement = Panel-SelectPort -Previous $port -ForceNew
  if ($replacement -le 0) {
    Add-Log "FATAL: retry could not find a free port in 8910-8999"
  }
  else {
    Add-Log ("RETRY: switching from port " + $port + " to " + $replacement)
    $port = $replacement
    $config | Add-Member -NotePropertyName port -NotePropertyValue $port -Force
    Panel-WriteJsonAtomic -Path $configPath -Object $config
    Update-PluginPort -Port $port
    $started = Start-SidecarOnce -Port $port
  }
}

if (-not $started) {
  Add-Log "FATAL: sidecar did not start"
  Write-LaunchLog $header
  exit 1
}

Write-LaunchLog $header
exit 0
