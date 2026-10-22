# stop-sidecar.ps1
#
# Stops YouTubePanel sidecars regardless of where they were installed
# (%LOCALAPPDATA%, %PUBLIC%, or a custom folder), waits for the configured
# sidecar port to be released, and only then kills mpv/yt-dlp processes that
# belong to a YouTubePanel install. Unrelated node processes are never touched.
#
# The port and token are read from {InstallDir}\config.json. There is no
# hardcoded 8910 fallback: with no config the script still stops sidecars but
# skips the port wait.
#
# This script never modifies PATH.

param(
  [string]$InstallDir = $PSScriptRoot,
  [string[]]$ExtraRoots = @(),
  [int]$Port = 0,
  [int]$WaitSeconds = 15
)

$ErrorActionPreference = "SilentlyContinue"

$commonPath = Join-Path $InstallDir "panel-common.ps1"
if (-not (Test-Path -LiteralPath $commonPath -PathType Leaf)) {
  $commonPath = Join-Path $PSScriptRoot "panel-common.ps1"
}
if (Test-Path -LiteralPath $commonPath -PathType Leaf) { . $commonPath }

function Get-PortOwner {
  param([int]$LocalPort)
  if ($LocalPort -le 0) { return 0 }
  try {
    $conn = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction Stop | Select-Object -First 1
    if ($conn -and $conn.OwningProcess) { return [int]$conn.OwningProcess }
  }
  catch { }
  try {
    $pattern = ":" + $LocalPort + "\s+\S+\s+LISTENING\s+(\d+)"
    foreach ($line in @(netstat -ano -p tcp)) {
      if ([string]$line -match $pattern) { return [int]$Matches[1] }
    }
  }
  catch { }
  return 0
}

function Stop-ProcessTree {
  param([int]$ProcessId)
  if ($ProcessId -le 0) { return }
  try { & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null } catch { }
  Start-Sleep -Milliseconds 150
  try {
    if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
      Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  catch { }
}

$roots = New-Object System.Collections.ArrayList
function Add-Root {
  param([string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) { return }
  $full = $Path
  try { $full = [System.IO.Path]::GetFullPath($Path) } catch { }
  $full = $full.TrimEnd('\')
  foreach ($existing in $roots) {
    if ([string]::Equals([string]$existing, $full, [System.StringComparison]::OrdinalIgnoreCase)) { return }
  }
  [void]$roots.Add($full)
}

if ($commonPath) {
  foreach ($root in (Panel-GetInstallRoots -InstallDir $InstallDir -ExtraRoots $ExtraRoots)) {
    Add-Root ([string]$root)
  }
}
else {
  Add-Root $InstallDir
  if ($env:LOCALAPPDATA) { Add-Root (Join-Path $env:LOCALAPPDATA "YouTubePanel") }
  if ($env:PUBLIC) { Add-Root (Join-Path $env:PUBLIC "YouTubePanel") }
  foreach ($extra in $ExtraRoots) { Add-Root $extra }
}

# ------------------------------------------------------------ configured port
$configPath = Join-Path $InstallDir "config.json"
$config = $null
if (Test-Path -LiteralPath $configPath -PathType Leaf) {
  try { $config = Get-Content -LiteralPath $configPath -Raw -ErrorAction Stop | ConvertFrom-Json } catch { $config = $null }
}
if ($Port -le 0 -and $null -ne $config -and $config.PSObject.Properties.Name -contains "port") {
  $parsed = 0
  if ([int]::TryParse([string]$config.port, [ref]$parsed)) { $Port = $parsed }
}

$handled = 0

function Test-UnderRoot {
  param([string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
  foreach ($root in $roots) {
    if ($Path.StartsWith([string]$root + "\", [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    if ([string]::Equals($Path, [string]$root, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  return $false
}

function Get-SidecarRoot {
  param([string]$CommandLine)
  $match = [regex]::Match([string]$CommandLine, '(?i)(?:"([^"]*?)\\sidecar\.js"|(\S*?)\\sidecar\.js)')
  if (-not $match.Success) { return "" }
  $path = $match.Groups[1].Value
  if ([string]::IsNullOrWhiteSpace($path)) { $path = $match.Groups[2].Value }
  if ([string]::IsNullOrWhiteSpace($path)) { return "" }
  return (Split-Path -Parent $path)
}

# 1. Any node process running sidecar.js under a YouTubePanel install root.
$nodeProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue)
foreach ($process in $nodeProcesses) {
  $commandLine = [string]$process.CommandLine
  if ($commandLine -notmatch '(?i)sidecar\.js') { continue }

  $processId = [int]$process.ProcessId
  $exePath = [string]$process.ExecutablePath
  $sidecarRoot = Get-SidecarRoot -CommandLine $commandLine

  $belongs = $false
  if ($commandLine -match '(?i)YouTubePanel') { $belongs = $true }
  if (Test-UnderRoot $sidecarRoot) { $belongs = $true }
  if (Test-UnderRoot ([System.IO.Path]::GetDirectoryName($exePath))) { $belongs = $true }
  if (-not $belongs -and $sidecarRoot) {
    $leaf = Split-Path -Leaf $sidecarRoot
    if ($leaf -match '(?i)YouTubePanel') { $belongs = $true }
  }

  if (-not $belongs) { continue }

  if ($sidecarRoot) {
    Add-Root $sidecarRoot
    # {app}\runtime\node.exe -> {app}
    if ($exePath -and (Test-Path -LiteralPath (Split-Path -Parent $exePath) -PathType Container)) {
      $exeDir = Split-Path -Parent $exePath
      if ((Split-Path -Leaf $exeDir) -match '(?i)runtime') { Add-Root (Split-Path -Parent $exeDir) }
    }
  }

  Stop-ProcessTree $processId
  $handled++
}

# 2. The PID recorded by the install's sidecar.pid, but only if it is a
#    sidecar. This avoids killing an unrelated process that reused the PID.
$pidFile = Join-Path $InstallDir "sidecar.pid"
if (Test-Path -LiteralPath $pidFile) {
  $sidecarPid = 0
  try { $sidecarPid = [int]((Get-Content -LiteralPath $pidFile -Raw).Trim()) } catch { $sidecarPid = 0 }
  if ($sidecarPid -gt 0) {
    $recorded = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $sidecarPid) -ErrorAction SilentlyContinue
    if ($recorded -and ([string]$recorded.CommandLine) -match '(?i)sidecar\.js') {
      Stop-ProcessTree $sidecarPid
      $handled++
    }
  }
}

# 3. Wait for the configured port to become free. Re-kill only if the owner is a sidecar.
if ($Port -gt 0) {
  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  while ((Get-Date) -lt $deadline) {
    $owner = Get-PortOwner -LocalPort $Port
    if ($owner -eq 0) { break }
    $ownerProcess = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $owner) -ErrorAction SilentlyContinue
    if ($ownerProcess -and ([string]$ownerProcess.CommandLine) -match '(?i)sidecar\.js') {
      Stop-ProcessTree $owner
      $handled++
    }
    else {
      # Some unrelated program owns the port. Never kill it.
      break
    }
    Start-Sleep -Milliseconds 250
  }

  $remainingOwner = Get-PortOwner -LocalPort $Port
  if ($remainingOwner -ne 0) {
    Write-Warning ("Port " + $Port + " is still owned by PID " + $remainingOwner + ". It was not started by YouTubePanel.")
  }
}

# 4. Kill only mpv/yt-dlp that live under a YouTubePanel install directory.
function Test-UnderYouTubePanel {
  param([string]$ExePath)
  if ([string]::IsNullOrWhiteSpace($ExePath)) { return $false }
  if (Test-UnderRoot $ExePath) { return $true }
  return ($ExePath -match '(?i)\\YouTubePanel\\')
}

foreach ($name in @("mpv.exe", "yt-dlp.exe")) {
  $mediaProcesses = @(Get-CimInstance Win32_Process -Filter ("Name = '" + $name + "'") -ErrorAction SilentlyContinue)
  foreach ($process in $mediaProcesses) {
    $exePath = [string]$process.ExecutablePath
    if (Test-UnderYouTubePanel $exePath) {
      Stop-ProcessTree ([int]$process.ProcessId)
      $handled++
    }
  }
}

# 5. Remove the PID file once the recorded process is gone.
$pidStillRunning = $false
if (Test-Path -LiteralPath $pidFile) {
  $sidecarPid = 0
  try { $sidecarPid = [int]((Get-Content -LiteralPath $pidFile -Raw).Trim()) } catch { $sidecarPid = 0 }
  if ($sidecarPid -gt 0 -and (Get-Process -Id $sidecarPid -ErrorAction SilentlyContinue)) { $pidStillRunning = $true }
}
if (-not $pidStillRunning) {
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

Write-Output ("YouTubePanel sidecar stop complete. Processes handled: " + $handled)
