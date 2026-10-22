# path-audit.ps1
#
# Read-only audit of the current user's PATH.
#
# Flags entries that are reparse points (junctions/symlinks), that cannot be
# stat'ed, or that cannot be traversed. A user PATH entry pointing at a junction
# into an untrusted mount is what makes yt-dlp fail with Windows error 448.
#
# This script NEVER modifies PATH. Exit 0 = clean, exit 1 = unsafe entries found.
# The installer treats a nonzero result as a warning because start-sidecar.ps1
# filters those entries out of the sidecar's PATH.

param(
  [string]$LogPath
)

$ErrorActionPreference = "Continue"

if ([string]::IsNullOrWhiteSpace($LogPath)) {
  $LogPath = Join-Path $PSScriptRoot "path-audit.log"
}

$lines = New-Object System.Collections.ArrayList
function Add-Line {
  param([string]$Text)
  [void]$lines.Add([string]$Text)
}

Add-Line "YouTubePanel user PATH audit"
Add-Line ("Time:   " + (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"))
Add-Line "Source: HKCU\Environment\Path (read only; never modified)"
Add-Line ""

$rawPath = $null
try {
  $rawPath = (Get-ItemProperty -Path "HKCU:\Environment" -Name "Path" -ErrorAction Stop).Path
}
catch {
  $rawPath = $null
}

if ($null -eq $rawPath -or ([string]$rawPath).Trim() -eq "") {
  Add-Line "No user PATH is defined. Nothing to audit."
  try { Set-Content -LiteralPath $LogPath -Value $lines -Encoding UTF8 } catch { }
  Write-Host "YouTubePanel PATH audit: no user PATH is defined."
  Write-Host ("Log: " + $LogPath)
  exit 0
}

$entries = @()
if ($rawPath -is [array]) { $entries = @($rawPath -join ";" -split ";") }
else { $entries = @(([string]$rawPath) -split ";") }

function Get-AncestorReparsePoint {
  param([string]$Path)
  $current = $Path
  while (-not [string]::IsNullOrWhiteSpace($current)) {
    $item = $null
    try { $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop } catch { break }
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      return [string]$item.FullName
    }
    $parent = Split-Path -Parent $current
    if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $current) { break }
    $current = $parent
  }
  return $null
}

function Get-TraversalError {
  param([string]$Path)
  try {
    $enumerator = [System.IO.Directory]::EnumerateFileSystemEntries($Path).GetEnumerator()
    try { [void]$enumerator.MoveNext() } finally { $enumerator.Dispose() }
    return $null
  }
  catch {
    return $_.Exception.Message
  }
}

$total = 0
$unsafe = 0

foreach ($rawEntry in $entries) {
  $entry = [string]$rawEntry
  if ([string]::IsNullOrWhiteSpace($entry)) { continue }
  $entry = $entry.Trim().Trim('"').Trim()
  if ($entry -eq "") { continue }
  $total++

  $expanded = $entry
  try { $expanded = [System.Environment]::ExpandEnvironmentVariables($entry) } catch { }

  $status = "ok"
  $reason = ""

  if (-not [System.IO.Path]::IsPathRooted($expanded)) {
    $status = "unsafe"
    $reason = "relative path (not absolute)"
  }
  else {
    $item = $null
    try {
      $item = Get-Item -LiteralPath $expanded -Force -ErrorAction Stop
    }
    catch {
      $status = "unsafe"
      $reason = "cannot stat: " + $_.Exception.Message
    }

    if ($status -eq "ok") {
      if (-not $item.PSIsContainer) {
        $status = "unsafe"
        $reason = "not a directory"
      }
      elseif (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        $status = "unsafe"
        $reason = "is a reparse point (junction/symlink)"
      }
      else {
        $ancestor = Get-AncestorReparsePoint ([string]$item.FullName)
        if ($ancestor) {
          $status = "unsafe"
          $reason = "ancestor is a reparse point: " + $ancestor
        }
        else {
          $traversalError = Get-TraversalError ([string]$item.FullName)
          if ($traversalError) {
            $status = "unsafe"
            $reason = "cannot be traversed: " + $traversalError
          }
        }
      }
    }
  }

  if ($status -eq "ok") {
    Add-Line ("[OK]      " + $expanded)
  }
  else {
    $unsafe++
    Add-Line ("[UNSAFE]  " + $expanded)
    Add-Line ("          reason: " + $reason)
  }
}

Add-Line ""
Add-Line ("Entries: " + $total + "  unsafe: " + $unsafe)
if ($unsafe -gt 0) {
  Add-Line "start-sidecar.ps1 filters these entries out of the sidecar PATH, so playback can still work."
  Add-Line "Other tools that walk PATH directly can still fail with Windows error 448."
}

try { Set-Content -LiteralPath $LogPath -Value $lines -Encoding UTF8 } catch { }

Write-Host "YouTubePanel user PATH audit"
Write-Host ("  entries: " + $total)
Write-Host ("  unsafe:  " + $unsafe)
Write-Host ("  log:     " + $LogPath)

if ($unsafe -gt 0) {
  Write-Host "Unsafe user PATH entries were found (PATH was not modified)."
  exit 1
}

Write-Host "All user PATH entries look safe."
exit 0
