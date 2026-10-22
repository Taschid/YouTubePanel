param(
  [string]$Version = "0.5.3",
  [string]$NodePath = "",
  [string]$MpvPath = "",
  [string]$YtDlpPath = "",
  [string]$YtDlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
  [string]$InnoCompiler = ""
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$build = Join-Path $PSScriptRoot "build"
$payload = Join-Path $build "payload"
$runtime = Join-Path $payload "runtime"
$bin = Join-Path $payload "bin"
$licenses = Join-Path $payload "licenses"

function Resolve-Tool {
  param(
    [string]$Explicit,
    [string]$Command,
    [string]$Label,
    [string[]]$Candidates
  )
  if (-not [string]::IsNullOrWhiteSpace($Explicit)) {
    if (-not (Test-Path -LiteralPath $Explicit -PathType Leaf)) {
      throw ($Label + " not found at the explicit path: " + $Explicit)
    }
    return (Resolve-Path -LiteralPath $Explicit).Path
  }

  if (-not [string]::IsNullOrWhiteSpace($Command)) {
    $found = Get-Command $Command -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found -and $found.Source -and (Test-Path -LiteralPath $found.Source -PathType Leaf)) {
      return $found.Source
    }
  }

  foreach ($candidate in $Candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  $searched = @()
  if ($Command) { $searched += ("Get-Command " + $Command) }
  $searched += $Candidates
  throw ($Label + " was not found. Pass the matching script parameter explicitly or add " + $Command + " to PATH. Searched: " + ($searched -join "; "))
}

$NodePath = Resolve-Tool -Explicit $NodePath -Command "node.exe" -Label "Node" -Candidates @(
  (Join-Path $env:ProgramFiles "nodejs\node.exe"),
  $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe" } else { "" }),
  (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe"),
  (Join-Path $env:LOCALAPPDATA "nvs\node.exe")
)

$MpvCandidates = @(
  (Join-Path $env:ProgramFiles "MPV Player\mpv.exe"),
  (Join-Path $env:ProgramFiles "mpv\mpv.exe"),
  $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} "MPV Player\mpv.exe" } else { "" }),
  (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\mpv.exe"),
  (Join-Path $env:LOCALAPPDATA "Programs\mpv\mpv.exe"),
  (Join-Path $env:LOCALAPPDATA "YouTubePanel\bin\mpv.exe"),
  $(if ($env:PUBLIC) { Join-Path $env:PUBLIC "YouTubePanel\bin\mpv.exe" } else { "" }),
  (Join-Path $PSScriptRoot "build\payload\bin\mpv.exe")
)
$MpvPath = Resolve-Tool -Explicit $MpvPath -Command "mpv.exe" -Label "Mpv" -Candidates $MpvCandidates

$InnoCompiler = Resolve-Tool -Explicit $InnoCompiler -Command "ISCC.exe" -Label "InnoCompiler" -Candidates @(
  (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
  (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe"),
  $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe" } else { "" })
)

Write-Output ("Using Node:   " + $NodePath)
Write-Output ("Using mpv:    " + $MpvPath)
Write-Output ("Using ISCC:   " + $InnoCompiler)

Remove-Item $build -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $payload, $runtime, $bin, $licenses -Force | Out-Null

Copy-Item (Join-Path $repo "YouTubePanel.plugin.js") $payload -Force
Copy-Item (Join-Path $repo "tools\youtube-sidecar\sidecar.js") $payload -Force
Copy-Item (Join-Path $repo "tools\youtube-sidecar\lib.js") $payload -Force
Copy-Item (Join-Path $PSScriptRoot "payload\*") $payload -Recurse -Force
Copy-Item $NodePath (Join-Path $runtime "node.exe") -Force
Copy-Item $MpvPath (Join-Path $bin "mpv.exe") -Force

$ytdlp = Join-Path $bin "yt-dlp.exe"
if (-not [string]::IsNullOrWhiteSpace($YtDlpPath)) {
  if (-not (Test-Path -LiteralPath $YtDlpPath -PathType Leaf)) {
    throw ("yt-dlp.exe not found at the explicit path: " + $YtDlpPath)
  }
  Copy-Item -LiteralPath $YtDlpPath -Destination $ytdlp -Force
}
else {
  Invoke-WebRequest -Uri $YtDlpUrl -OutFile $ytdlp -UseBasicParsing
}
if (-not (Test-Path -LiteralPath $ytdlp) -or (Get-Item -LiteralPath $ytdlp).Length -lt 1000000) {
  throw "yt-dlp.exe download/copy failed"
}

# The installer selects a free port in 8910-8999 at install time. This is only
# the packaged default used before the first launch.
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
if (-not (Test-Path -LiteralPath $output)) { throw "Installer output not found: $output" }
Write-Output ("Built: " + $output)
Write-Output ("Size:  " + [math]::Round((Get-Item -LiteralPath $output).Length / 1MB, 1) + " MB")
