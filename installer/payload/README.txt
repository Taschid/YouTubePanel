YouTubePanel sidecar install

This folder is managed by YouTubePanel-Setup.exe.

- The BetterDiscord plugin was copied to:
  %APPDATA%\BetterDiscord\plugins\YouTubePanel.plugin.js
- The sidecar listens only on 127.0.0.1 and uses the port in config.json.
  Setup picks a free port in 8910-8999; the plugin sidecarUrl is kept in sync.
  The token in config.json is the single runtime token.
- It starts automatically at Windows login. The Run key launches hidden
  PowerShell directly (start-sidecar.ps1). start-sidecar.vbs is only a manual
  fallback for environments that block PowerShell.
- Logs and diagnostics in this folder:
    sidecar.log            sidecar output
    sidecar-launch.log     launcher PATH filter and port/PID checks
    path-audit.log         read-only audit of your user PATH
    install-report.json    install version, path, port, selftests, errors
    configure-report.json  plugin validation and data-branch updates
- Stop it: run stop-sidecar.ps1 from this folder.
- Health check: run healthcheck.ps1 from this folder.
  Local checks are hard; network playback is reported as verified or
  unverified. Add -RequirePlayback for a strict playback gate.

The sidecar needs no system-wide Node, yt-dlp or mpv install. Those are bundled.
Uninstall removes the sidecar, startup entry, and BetterDiscord plugin. It never
edits PATH. YouTubePanel.config.json (and its .bak) are settings and are left in
place.
