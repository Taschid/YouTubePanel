param(
  [string]$Version = "0.5.1",
  [string]$NodePath = "C:\Program Files\nodejs\node.exe",
  [string]$MpvPath = "C:\Program Files\MPV Player\mpv.exe",
  [string]$YtDlpPath = "",
  [string]$YtDlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
  [string]$InnoCompiler = "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$build = Join-Path $PSScriptRoot "build"
$payload = Join-Path $build "payload"
$runtime = Join-Path $payload "runtime"
$bin = Join-Path $payload "bin"
$licenses = Join-Path $payload "licenses"

if (-not (Test-Path $NodePath)) { throw "node.exe not found: $NodePath" }
if (-not (Test-Path $MpvPath)) { throw "mpv.exe not found: $MpvPath" }
if (-not (Test-Path $InnoCompiler)) { throw "Inno Setup compiler not found: $InnoCompiler" }

Remove-Item $build -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $payload, $runtime, $bin, $licenses -Force | Out-Null

Copy-Item (Join-Path $repo "YouTubePanel.plugin.js") $payload -Force
Copy-Item (Join-Path $repo "tools\youtube-sidecar\sidecar.js") $payload -Force
Copy-Item (Join-Path $repo "tools\youtube-sidecar\lib.js") $payload -Force
Copy-Item (Join-Path $PSScriptRoot "payload\*") $payload -Recurse -Force
Copy-Item $NodePath (Join-Path $runtime "node.exe") -Force
Copy-Item $MpvPath (Join-Path $bin "mpv.exe") -Force

$ytdlp = Join-Path $bin "yt-dlp.exe"
if ($YtDlpPath) {
  if (-not (Test-Path $YtDlpPath)) { throw "yt-dlp.exe not found: $YtDlpPath" }
  Copy-Item $YtDlpPath $ytdlp -Force
}
else {
  Invoke-WebRequest -Uri $YtDlpUrl -OutFile $ytdlp -UseBasicParsing
}
if (-not (Test-Path $ytdlp) -or (Get-Item $ytdlp).Length -lt 1000000) {
  throw "yt-dlp.exe download/copy failed"
}

$config = [ordered]@{
  port = 8910
  token = "youtube-panel"
  mpvPath = "bin\mpv.exe"
  ytdlpPath = "bin\yt-dlp.exe"
  volume = 70
  searchLimit = 15
}
$config | ConvertTo-Json | Set-Content (Join-Path $payload "config.json") -Encoding ascii

$nodeVersion = (& $NodePath --version).Trim()
$ytdlpVersion = (& $ytdlp --version).Trim()
$mpvVersion = (& $MpvPath --version | Select-Object -First 1).Trim()
@(
  "YouTubePanel installer $Version",
  "Node $nodeVersion",
  "yt-dlp $ytdlpVersion",
  "mpv $mpvVersion",
  "Built $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))"
) | Set-Content (Join-Path $payload "about.txt") -Encoding utf8

try {
  Invoke-WebRequest -Uri "https://raw.githubusercontent.com/nodejs/node/main/LICENSE" -OutFile (Join-Path $licenses "node-LICENSE.txt") -UseBasicParsing
  Invoke-WebRequest -Uri "https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/LICENSE" -OutFile (Join-Path $licenses "yt-dlp-LICENSE.txt") -UseBasicParsing
  Invoke-WebRequest -Uri "https://raw.githubusercontent.com/mpv-player/mpv/master/Copyright" -OutFile (Join-Path $licenses "mpv-Copyright.txt") -UseBasicParsing
}
catch {
  Write-Warning "Some license files could not be downloaded: $($_.Exception.Message)"
}

Push-Location $PSScriptRoot
try {
  & $InnoCompiler "/DAppVersion=$Version" "YouTubePanel.iss"
  if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed with exit code $LASTEXITCODE" }
}
finally {
  Pop-Location
}

$output = Join-Path $PSScriptRoot "output\YouTubePanel-Setup-$Version.exe"
if (-not (Test-Path $output)) { throw "Installer output not found: $output" }
Write-Output ("Built: " + $output)
Write-Output ("Size:  " + [math]::Round((Get-Item $output).Length / 1MB, 1) + " MB")
