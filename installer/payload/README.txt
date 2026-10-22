YouTubePanel sidecar install

This folder is managed by YouTubePanel-Setup.exe.

- The BetterDiscord plugin was copied to:
  %APPDATA%\BetterDiscord\plugins\YouTubePanel.plugin.js
- The sidecar listens only on 127.0.0.1:8910.
- It starts automatically at Windows login via the current-user Run key.
- Logs: sidecar.log in this folder.
- Stop it: run stop-sidecar.ps1 from this folder.
- Health check: run healthcheck.ps1 from this folder.

The sidecar needs no system-wide Node, yt-dlp or mpv install. Those are bundled.
Uninstall removes the sidecar, startup entry, and BetterDiscord plugin. The
YouTubePanel.config.json settings file is left in place.
