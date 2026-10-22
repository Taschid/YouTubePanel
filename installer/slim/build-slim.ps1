param(
  [string]$Version = "0.5.0",
  [string]$InnoCompiler = "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$build = Join-Path $PSScriptRoot "build"
$payload = Join-Path $build "payload"
$licenses = Join-Path $payload "licenses"

if (-not (Test-Path $InnoCompiler)) { throw "Inno Setup compiler not found: $InnoCompiler" }

Remove-Item $build -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $payload, $licenses -Force | Out-Null

Copy-Item (Join-Path $repo "YouTubePanel.plugin.js") $payload -Force
Copy-Item (Join-Path $repo "tools\youtube-sidecar\sidecar.js") $payload -Force
Copy-Item (Join-Path $repo "tools\youtube-sidecar\lib.js") $payload -Force
Copy-Item (Join-Path $PSScriptRoot "..\payload\*") $payload -Recurse -Force

$config = [ordered]@{
  port = 8910
  token = "youtube-panel"
  mpvPath = "bin\mpv.exe"
  ytdlpPath = "bin\yt-dlp.exe"
  volume = 70
  searchLimit = 15
}
$config | ConvertTo-Json | Set-Content (Join-Path $payload "config.json") -Encoding ascii

try {
  Invoke-WebRequest -Uri "https://raw.githubusercontent.com/nodejs/node/main/LICENSE" -OutFile (Join-Path $licenses "node-LICENSE.txt") -UseBasicParsing
  Invoke-WebRequest -Uri "https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/LICENSE" -OutFile (Join-Path $licenses "yt-dlp-LICENSE.txt") -UseBasicParsing
  Invoke-WebRequest -Uri "https://raw.githubusercontent.com/mpv-player/mpv/master/Copyright" -OutFile (Join-Path $licenses "mpv-Copyright.txt") -UseBasicParsing
}
catch {
  Write-Warning "Some license files could not be downloaded: $($_.Exception.Message)"
}

@(
  "YouTubePanel slim installer $Version",
  "Node v24.19.0 (downloaded and SHA-256 verified at install)",
  "mpv 20261021-git-e471496c56 (downloaded and SHA-256 verified at install)",
  "yt-dlp 2026.10.21 (downloaded and SHA-256 verified at install)",
  "Built $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))"
) | Set-Content (Join-Path $payload "about.txt") -Encoding utf8

Push-Location $PSScriptRoot
try {
  & $InnoCompiler "/DAppVersion=$Version" "YouTubePanel-slim.iss"
  if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed with exit code $LASTEXITCODE" }
}
finally {
  Pop-Location
}

$output = Join-Path $PSScriptRoot "..\output\YouTubePanel-Setup-$Version-slim.exe"
if (-not (Test-Path $output)) { throw "Installer output not found: $output" }
Write-Output ("Built: " + (Resolve-Path $output))
Write-Output ("Size:  " + [math]::Round((Get-Item $output).Length / 1MB, 1) + " MB")
