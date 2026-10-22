param(
  [string]$InstallDir = $PSScriptRoot
)

$ErrorActionPreference = "SilentlyContinue"
$pidFile = Join-Path $InstallDir "sidecar.pid"

if (Test-Path $pidFile) {
  $sidecarPid = [int]((Get-Content $pidFile -Raw).Trim())
  if ($sidecarPid -gt 0) {
    Stop-Process -Id $sidecarPid -Force
    Start-Sleep -Milliseconds 300
    if (Get-Process -Id $sidecarPid -ErrorAction SilentlyContinue) {
      & taskkill.exe /PID $sidecarPid /F | Out-Null
    }
  }
}

$processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
foreach ($process in $processes) {
  if ($process.CommandLine -and $process.CommandLine -like "*$InstallDir*sidecar.js*") {
    & taskkill.exe /PID $process.ProcessId /F | Out-Null
  }
}

$listeners = @(Get-NetTCPConnection -LocalPort 8910 -State Listen -ErrorAction SilentlyContinue)
foreach ($listener in $listeners) {
  $owner = $processes | Where-Object { $_.ProcessId -eq $listener.OwningProcess } | Select-Object -First 1
  if ($owner -and $owner.CommandLine -and $owner.CommandLine -match "sidecar\.js") {
    & taskkill.exe /PID $owner.ProcessId /F | Out-Null
  }
}

$owned = @(Get-Process -Name mpv, yt-dlp -ErrorAction SilentlyContinue)
foreach ($process in $owned) {
  if ($process.Path -and $process.Path.StartsWith($InstallDir, [System.StringComparison]::OrdinalIgnoreCase)) {
    Stop-Process -Id $process.Id -Force
  }
}

Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
