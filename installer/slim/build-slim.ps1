param(
  [string]$Version = "0.5.3",
  [string]$InnoCompiler = ""
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$build = Join-Path $PSScriptRoot "build"
$payload = Join-Path $build "payload"
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

  throw ($Label + " was not found. Pass -InnoCompiler or add ISCC.exe to PATH.")
}

$InnoCompiler = Resolve-Tool -Explicit $InnoCompiler -Command "ISCC.exe" -Label "InnoCompiler" -Candidates @(
  (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
  (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe"),
  $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe" } else { "" })
)

Write-Output ("Using ISCC: " + $InnoCompiler)

Remove-Item $build -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $payload, $licenses -Force | Out-Null

Copy-Item (Join-Path $repo "YouTubePanel.plugin.js") $payload -Force
Copy-Item (Join-Path $repo "tools\youtube-sidecar\sidecar.js") $payload -Force
Copy-Item (Join-Path $repo "tools\youtube-sidecar\lib.js") $payload -Force
Copy-Item (Join-Path $PSScriptRoot "..\payload\*") $payload -Recurse -Force

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
if (-not (Test-Path -LiteralPath $output)) { throw "Installer output not found: $output" }
Write-Output ("Built: " + (Resolve-Path $output))
Write-Output ("Size:  " + [math]::Round((Get-Item -LiteralPath $output).Length / 1MB, 1) + " MB")
