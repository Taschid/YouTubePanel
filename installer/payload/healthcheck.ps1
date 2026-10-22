param(
  [string]$Url = "http://127.0.0.1:8910/health",
  [string]$Token = "youtube-panel",
  [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = "SilentlyContinue"
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
  try {
    $result = Invoke-RestMethod -Uri $Url -Headers @{ "X-Panel-Token" = $Token } -TimeoutSec 3
    if ($result.mpv -eq $true) {
      Write-Output "YouTubePanel sidecar is healthy."
      exit 0
    }
  }
  catch {}
  Start-Sleep -Milliseconds 750
}

Write-Error "YouTubePanel sidecar did not become healthy."
exit 1
