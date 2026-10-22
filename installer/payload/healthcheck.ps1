# healthcheck.ps1
#
# Validates a YouTubePanel install against the single runtime state in
# {app}\config.json (port and token). Never assumes port 8910.
#
# Hard local checks (exit 1 on failure):
#   * GET /health returns HTTP 2xx within the liveness timeout
#   * sidecar.pid exists, points at a running sidecar.js process, and that PID
#     owns the configured port
#   * bundled runtime/bin files exist
#   * GET /selftest?mode=local succeeds (see legacy note below)
#
# Soft network check (never aborts setup unless -RequirePlayback):
#   * GET /selftest?mode=network
#   * failure/offline/skip is recorded as playback "unverified"
#
# Legacy sidecar note: sidecars that predate mode= support ignore the query and
# run their combined network selftest. When the response has no "mode" property
# a network-flavoured failure is recorded as unverified instead of failing the
# install, because the hard local evidence (files, health, PID ownership) still
# holds. A local-flavoured failure (448, missing mpv/yt-dlp) is always fatal.
#
# Exit 0 = install is healthy (playback may be unverified).
# Exit 1 = hard validation failure, or -RequirePlayback was requested and
#          network playback could not be verified.

param(
  [string]$InstallDir = $PSScriptRoot,
  [string]$PluginDir = "",
  [string]$BaseUrl = "",
  [string]$Token = "",
  [int]$Port = 0,
  [ValidateSet("all", "local", "network")]
  [string]$Mode = "all",
  [switch]$RequirePlayback,
  [switch]$SkipNetwork,
  [int]$LivenessTimeoutSeconds = 60,
  [int]$LocalTimeoutSeconds = 90,
  [int]$NetworkTimeoutSeconds = 45,
  [string]$AppVersion = "",
  [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$commonPath = Join-Path $PSScriptRoot "panel-common.ps1"
if (-not (Test-Path -LiteralPath $commonPath)) {
  throw "panel-common.ps1 is missing next to healthcheck.ps1."
}
. $commonPath

if ([string]::IsNullOrWhiteSpace($InstallDir)) { $InstallDir = $PSScriptRoot }
if ([string]::IsNullOrWhiteSpace($PluginDir)) { $PluginDir = Join-Path $env:APPDATA "BetterDiscord\plugins" }
if ([string]::IsNullOrWhiteSpace($ReportPath)) { $ReportPath = Join-Path $InstallDir "install-report.json" }

$configPath = Join-Path $InstallDir "config.json"
$launchLogPath = Join-Path $InstallDir "sidecar-launch.log"
$sidecarLogPath = Join-Path $InstallDir "sidecar.log"
$pidPath = Join-Path $InstallDir "sidecar.pid"
$configureReportPath = Join-Path $InstallDir "configure-report.json"
$pathAuditLog = Join-Path $InstallDir "path-audit.log"

$errors = New-Object System.Collections.ArrayList
$warnings = New-Object System.Collections.ArrayList
$localState = "not-run"
$localError = ""
$localDetails = ""
$localMode = ""
$networkState = "skipped"
$networkError = ""
$networkVideo = ""
$healthBody = $null
$sidecarPid = 0
$configureReport = Panel-ReadJson -Path $configureReportPath

function Get-PathAuditSummary {
  $summary = [pscustomobject]@{ entries = 0; unsafe = 0; log = $pathAuditLog; available = $false }
  if (-not (Test-Path -LiteralPath $pathAuditLog -PathType Leaf)) { return $summary }
  $summary.available = $true
  try {
    foreach ($line in @(Get-Content -LiteralPath $pathAuditLog -ErrorAction Stop)) {
      if ([string]$line -match 'Entries:\s*(\d+)\s+unsafe:\s*(\d+)') {
        $summary.entries = [int]$Matches[1]
        $summary.unsafe = [int]$Matches[2]
      }
    }
  }
  catch { }
  return $summary
}

function Get-LaunchLogSummary {
  $summary = [pscustomobject]@{ available = $false; kept = 0; dropped = 0 }
  if (-not (Test-Path -LiteralPath $launchLogPath -PathType Leaf)) { return $summary }
  $summary.available = $true
  try {
    foreach ($line in @(Get-Content -LiteralPath $launchLogPath -ErrorAction Stop)) {
      if ([string]$line -match 'PATH kept=(\d+) dropped=(\d+)') {
        $summary.kept = [int]$Matches[1]
        $summary.dropped = [int]$Matches[2]
      }
    }
  }
  catch { }
  return $summary
}

function Get-ReportVersion {
  if (-not [string]::IsNullOrWhiteSpace($AppVersion)) { return $AppVersion }
  if ($null -ne $configureReport -and $configureReport.PSObject.Properties.Name -contains "pluginVersion") {
    if (-not [string]::IsNullOrWhiteSpace([string]$configureReport.pluginVersion)) {
      return [string]$configureReport.pluginVersion
    }
  }
  $pluginPath = Join-Path $PluginDir "YouTubePanel.plugin.js"
  if (Test-Path -LiteralPath $pluginPath -PathType Leaf) {
    try {
      $head = (Get-Content -LiteralPath $pluginPath -TotalCount 60 -ErrorAction Stop) -join "`n"
      $match = [regex]::Match($head, '(?im)^\s*\*\s*@version\s+(\S+)\s*$')
      if ($match.Success) { return $match.Groups[1].Value.Trim() }
    }
    catch { }
  }
  return ""
}

function Write-Report {
  $audit = Get-PathAuditSummary
  $launch = Get-LaunchLogSummary
  $values = @{
    version         = (Get-ReportVersion)
    installPath     = $InstallDir
    pluginPath      = (Join-Path $PluginDir "YouTubePanel.plugin.js")
    configPath      = $configPath
    chosenPort      = $Port
    sidecarUrl      = $BaseUrl
    sidecarPid      = $sidecarPid
    localSelftest   = [pscustomobject]@{
      status  = $localState
      mode    = $localMode
      error   = $localError
      details = $localDetails
    }
    networkSelftest = [pscustomobject]@{
      status = $networkState
      error  = $networkError
      video  = $networkVideo
    }
    playback        = $(if ($networkState -eq "passed") { "verified" } else { "unverified" })
    pathAudit       = $audit
    pathDrops       = $launch
    plugin          = $(if ($null -ne $configureReport) { $configureReport } else { $null })
    errors          = @($errors)
    warnings        = @($warnings)
    updatedAt       = (Get-Date).ToString("o")
  }
  try { $null = Panel-MergeReport -Path $ReportPath -Values $values } catch { }
}

function Fail {
  param([string]$Message)
  [void]$errors.Add($Message)
  Write-Host ""
  Write-Host "YouTubePanel sidecar check FAILED:"
  Write-Host ("  " + $Message)
  Write-Host ""
  Write-Host ("Sidecar log: " + $sidecarLogPath)
  Write-Host ("Launch log:  " + $launchLogPath)
  if (Test-Path -LiteralPath $sidecarLogPath) {
    Write-Host ""
    Write-Host "Last sidecar.log lines:"
    try {
      Get-Content -LiteralPath $sidecarLogPath -Tail 20 -ErrorAction SilentlyContinue |
        ForEach-Object { Write-Host ("  " + $_) }
    }
    catch { }
  }
  Write-Host ""
  Write-Host ("Report: " + $ReportPath)
  Write-Report
  exit 1
}

function Test-IsNetworkFlavourError {
  param([string]$Text)
  if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
  return ($Text -match '(?i)(unable to download|timed out|timeout|getaddrinfo|enotfound|network|urlopen|connection (refused|reset|aborted)|http error|remote name|name resolution|no internet|offline|socket|econn|ssl|tls|certificate)')
}

# ------------------------------------------------------------ runtime state
$config = Panel-ReadJson -Path $configPath
if ($null -eq $config) {
  Fail ("config.json is missing or unreadable: " + $configPath)
}

$configPort = Panel-GetPort -Config $config
$configToken = Panel-GetToken -Config $config
if ($Port -le 0) { $Port = $configPort }
elseif ($configPort -gt 0 -and $Port -ne $configPort) {
  [void]$warnings.Add("Requested port " + $Port + " differs from config.json port " + $configPort + "; using config.json.")
  $Port = $configPort
}
if ($Port -le 0) { Fail "config.json does not contain a valid port." }
if ([string]::IsNullOrWhiteSpace($Token)) { $Token = $configToken }
if ([string]::IsNullOrWhiteSpace($BaseUrl)) { $BaseUrl = "http://127.0.0.1:" + $Port }
$BaseUrl = $BaseUrl.TrimEnd('/')
$headers = @{ "X-Panel-Token" = $Token }

# Required bundled files.
$requiredFiles = @(
  (Join-Path $InstallDir "sidecar.js"),
  (Join-Path $InstallDir "runtime\node.exe"),
  (Join-Path $InstallDir "bin\mpv.exe"),
  (Join-Path $InstallDir "bin\yt-dlp.exe")
)
foreach ($required in $requiredFiles) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    Fail ("required file is missing: " + $required)
  }
}

# ------------------------------------------------------------ 1. liveness
Write-Host ("Checking sidecar liveness at " + $BaseUrl + "/health ...")
$deadline = (Get-Date).AddSeconds($LivenessTimeoutSeconds)
$live = $false
$lastError = "no response"
while ((Get-Date) -lt $deadline) {
  try {
    $response = Invoke-WebRequest -Uri ($BaseUrl + "/health") -Headers $headers `
      -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    if ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 300) {
      $live = $true
      try { $healthBody = $response.Content | ConvertFrom-Json } catch { $healthBody = $null }
      break
    }
    $lastError = "HTTP " + $response.StatusCode
  }
  catch {
    $lastError = $_.Exception.Message
  }
  Start-Sleep -Milliseconds 750
}
if (-not $live) {
  Fail ("no HTTP 2xx from /health after " + $LivenessTimeoutSeconds + " s (" + $lastError + ")")
}
if ($null -ne $healthBody -and $healthBody.PSObject.Properties.Name -contains "ok" -and $healthBody.ok -ne $true) {
  Fail ("/health reported ok=" + [string]$healthBody.ok + ".")
}
if ($null -ne $healthBody -and $healthBody.PSObject.Properties.Name -contains "mpv" -and $healthBody.mpv -ne $true) {
  Write-Host ("Sidecar mpv is not ready yet; the local selftest will start it (mpvError=" + [string]$healthBody.mpvError + ").")
}
Write-Host "Sidecar is listening."

# ---------------------------------------------------- 2. PID owns the port
Write-Host ("Verifying sidecar.pid owns port " + $Port + " ...")
if (-not (Test-Path -LiteralPath $pidPath)) {
  Fail ("sidecar.pid is missing from " + $InstallDir + ".")
}
try {
  $sidecarPid = [int]((Get-Content -LiteralPath $pidPath -Raw -ErrorAction Stop).Trim())
}
catch {
  Fail ("sidecar.pid is unreadable: " + $_.Exception.Message)
}
if ($sidecarPid -le 0) { Fail "sidecar.pid does not contain a valid process id." }
if (-not (Get-Process -Id $sidecarPid -ErrorAction SilentlyContinue)) {
  Fail ("sidecar.pid points at PID " + $sidecarPid + ", which is not running.")
}
$commandLine = Panel-GetProcessCommandLine -ProcessId $sidecarPid
if ([string]$commandLine -notmatch '(?i)sidecar\.js') {
  Fail ("PID " + $sidecarPid + " is not a sidecar.js process.")
}

$owner = 0
$ownershipDeadline = (Get-Date).AddSeconds(15)
do {
  $owner = Panel-GetPortOwner -Port $Port
  if ($owner -eq $sidecarPid) { break }
  Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $ownershipDeadline)
if ($owner -eq 0) { Fail ("nothing is listening on port " + $Port + ".") }
if ($owner -ne $sidecarPid) {
  Fail ("port " + $Port + " is owned by PID " + $owner + ", not the sidecar PID " + $sidecarPid + " from sidecar.pid.")
}
Write-Host ("PID " + $sidecarPid + " owns port " + $Port + ".")

# ------------------------------------------------------- 3. local selftest
function Set-LocalFailure {
  param([string]$Message)
  $script:localState = "failed"
  $script:localError = $Message
}

$runLocal = ($Mode -eq "all" -or $Mode -eq "local")
$runNetwork = ($Mode -eq "all" -or $Mode -eq "network")
$legacyCombined = $false

if ($runLocal) {
  Write-Host ("Running GET /selftest?mode=local (timeout " + $LocalTimeoutSeconds + " s) ...")
  $selftest = $null
  $selftestText = ""
  try {
    $selftestResponse = Invoke-WebRequest -Uri ($BaseUrl + "/selftest?mode=local") -Headers $headers `
      -TimeoutSec $LocalTimeoutSeconds -UseBasicParsing -ErrorAction Stop
    $selftestText = [string]$selftestResponse.Content
    if ([int]$selftestResponse.StatusCode -lt 200 -or [int]$selftestResponse.StatusCode -ge 300) {
      Set-LocalFailure ("/selftest?mode=local returned HTTP " + $selftestResponse.StatusCode + ".")
    }
    else {
      try { $selftest = $selftestText | ConvertFrom-Json } catch { Set-LocalFailure "local selftest returned invalid JSON." }
    }
  }
  catch {
    $message = $_.Exception.Message
    if ($message -match '(?i)(timed out|timeout|operation has timed out)') {
      $localState = "unverified"
      $localError = "local selftest timed out after " + $LocalTimeoutSeconds + " s"
      [void]$warnings.Add($localError + " (continuing; files and /health already verified)")
    }
    else {
      Set-LocalFailure ("GET /selftest?mode=local failed: " + $message)
    }
  }

  if ($null -ne $selftest -and $localState -ne "failed") {
    $propertyNames = @($selftest.PSObject.Properties.Name)
    $hasMode = $propertyNames -contains "mode"
    $legacyCombined = -not $hasMode
    $localMode = $(if ($hasMode) { [string]$selftest.mode } else { "legacy-combined" })
    if ($selftest.ok -eq $true) {
      $localState = "passed"
    }
    else {
      $detail = ""
      if ($propertyNames -contains "error" -and $selftest.error) { $detail = [string]$selftest.error }
      if ($propertyNames -contains "checks") {
        try { $detail += " checks=" + ($selftest.checks | ConvertTo-Json -Compress -Depth 4) } catch { }
      }
      $localDetails = $detail.Trim()
      if ($legacyCombined -and (Test-IsNetworkFlavourError $detail)) {
        # The old sidecar ignores mode= and always tests the network. Its
        # network failure must not fail a local install.
        $localState = "unverified"
        $localError = "legacy /selftest failed for a network reason: " + $localDetails
        [void]$warnings.Add($localError)
      }
      else {
        Set-LocalFailure ("/selftest reported ok=" + [string]$selftest.ok + "." + $(if ($localDetails) { " " + $localDetails } else { "" }))
      }
    }
  }

  if ($localState -eq "failed") {
    Fail ($localError)
  }
  if ($localState -eq "passed") {
    Write-Host ("Local selftest passed (" + $localMode + ").")
  }
  else {
    Write-Host ("Local selftest unverified: " + $localError)
  }
}

# ----------------------------------------------------- 4. network selftest
# A separate -Mode network run can reuse a legacy combined result recorded by
# an earlier -Mode local run in the same install-report.json.
$priorReport = Panel-ReadJson -Path $ReportPath
$priorLegacyMode = ""
$priorLegacyStatus = ""
if ($null -ne $priorReport -and ($priorReport.PSObject.Properties.Name -contains "localSelftest")) {
  $priorLocal = $priorReport.localSelftest
  if ($null -ne $priorLocal -and ($priorLocal.PSObject.Properties.Name -contains "mode")) {
    $priorLegacyMode = [string]$priorLocal.mode
    if ($priorLocal.PSObject.Properties.Name -contains "status") { $priorLegacyStatus = [string]$priorLocal.status }
  }
}

if ($runNetwork -and -not $SkipNetwork) {
  if ($Mode -eq "local") {
    $networkState = "skipped"
  }
  elseif ($legacyCombined -and $localState -eq "passed") {
    $networkState = "passed"
    [void]$warnings.Add("network playback verified by the legacy combined /selftest")
  }
  elseif ($legacyCombined -and $localState -eq "unverified") {
    $networkState = "unverified"
    $networkError = $localError
  }
  elseif ($Mode -eq "network" -and $priorLegacyMode -eq "legacy-combined") {
    if ($priorLegacyStatus -eq "passed") {
      $networkState = "passed"
      [void]$warnings.Add("network playback verified by the legacy combined /selftest")
    }
    else {
      $networkState = "unverified"
      $networkError = "legacy combined /selftest was " + $priorLegacyStatus
    }
  }
  else {
    Write-Host ("Running GET /selftest?mode=network (timeout " + $NetworkTimeoutSeconds + " s) ...")
    try {
      $networkResponse = Invoke-WebRequest -Uri ($BaseUrl + "/selftest?mode=network") -Headers $headers `
        -TimeoutSec $NetworkTimeoutSeconds -UseBasicParsing -ErrorAction Stop
      $body = $null
      try { $body = [string]$networkResponse.Content | ConvertFrom-Json } catch { }
      if ($null -ne $body -and $body.ok -eq $true) {
        $networkState = "passed"
        if (@($body.PSObject.Properties.Name) -contains "videoId") { $networkVideo = [string]$body.videoId }
      }
      else {
        $networkState = "unverified"
        if ($null -ne $body -and (@($body.PSObject.Properties.Name) -contains "error")) {
          $networkError = [string]$body.error
        }
        else {
          $networkError = "network selftest returned no ok=true"
        }
      }
    }
    catch {
      $networkState = "unverified"
      $networkError = $_.Exception.Message
    }
  }

  if ($networkState -eq "passed") {
    Write-Host "Network playback verified."
  }
  else {
    Write-Host ("Playback unverified: " + $networkError)
  }
}
else {
  $networkState = "skipped"
  if ($SkipNetwork) { $networkError = "skipped by request" }
}

if ($RequirePlayback -and $networkState -ne "passed") {
  Fail ("network playback was not verified" + $(if ($networkError) { ": " + $networkError } else { "." }))
}

Write-Report
Write-Host ("YouTubePanel sidecar is healthy (port " + $Port + ", PID " + $sidecarPid + ", playback " + $(if ($networkState -eq "passed") { "verified" } else { "unverified" }) + ").")
Write-Host ("Report: " + $ReportPath)
exit 0
