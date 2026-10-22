# YouTubePanel sidecar installer

Status: v0.5.0 (2026-10-22)
Product: `YouTubePanel-Setup-0.5.0.exe`
Plugin: sidecar build restored from `youtubepanel-sidecar-v0.1.1`
Sidecar: `tools/youtube-sidecar/`

## 1. What the installer does

One per-user Windows installer for the sidecar build:

- Installs to `%LOCALAPPDATA%\YouTubePanel` (no admin).
- Bundles Node, yt-dlp, mpv and the sidecar JS.
- Copies `YouTubePanel.plugin.js` into
  `%APPDATA%\BetterDiscord\plugins`.
- Backs up an existing plugin as `.plugin.js.bak`.
- Merges `sidecarUrl`/`sidecarToken` into `YouTubePanel.config.json` without
  destroying bot/channel settings.
- Removes the obsolete `youtubeCookie` and `audioSource` settings.
- Starts the sidecar hidden, checks `/health`, and adds a current-user Run key
  so it starts at login.
- Ships an uninstaller that stops node/mpv/yt-dlp, removes startup, and removes
  the plugin.

## 2. Layout

```
%LOCALAPPDATA%\YouTubePanel\
  YouTubePanel.plugin.js   copy for reference
  sidecar.js
  lib.js
  config.json
  start-sidecar.vbs        hidden launcher
  stop-sidecar.ps1
  configure-plugin.ps1
  healthcheck.ps1
  README.txt
  THIRD-PARTY-NOTICES.txt
  licenses\
  runtime\node.exe
  bin\mpv.exe
  bin\d3dcompiler_43.dll   when present
  bin\yt-dlp.exe
```

## 3. Build

Requirements on the build machine:

- Windows x64
- Node.js (copied, not installed for the user)
- mpv
- Inno Setup 6
- Network for the latest official `yt-dlp.exe` and license files

Run:

```powershell
powershell -ExecutionPolicy Bypass -File installer\build.ps1 -Version 0.5.0
```

Optional overrides:

```powershell
-MpvPath "C:\path\mpv.exe"
-NodePath "C:\path\node.exe"
-YtDlpPath "C:\path\yt-dlp.exe"
```

Output: `installer\output\YouTubePanel-Setup-0.5.0.exe`.

Build artifacts (`installer/build`, `installer/output`) are intentionally not
committed.

## 4. Install flow

1. Inno Setup verifies that `%APPDATA%\BetterDiscord\plugins` exists.
2. Stops an older sidecar and backs up the old plugin.
3. Extracts runtime/binaries and copies the plugin.
4. Merges the sidecar URL/token into the plugin config.
5. Starts the hidden sidecar and polls `/health` for up to 45 seconds.
6. Adds the HKCU Run entry.
7. Shows a warning if health fails; install still completes.

The installer does not restart Discord. Toggle YouTubePanel or restart Discord
after installation.

## 5. Uninstall

- Stops the sidecar by PID/command line and kills only mpv/yt-dlp under the
  install directory.
- Removes the HKCU Run entry.
- Removes the plugin and install directory.
- Leaves `YouTubePanel.config.json` in place so bot/channel settings survive.

## 6. Validation

- Fresh Windows user profile:
  - Installer completes without admin.
  - `/health` returns `mpv: true`.
  - Plugin appears in BetterDiscord and Alt+Q opens it.
  - UMG/MONSTER plays; pause/seek/next/volume work.
  - Restart Windows; sidecar auto-starts; playback works.
  - Uninstall removes plugin, startup entry, and processes.
- Upgrade over an existing install preserves config and stops the old sidecar.
- Existing plugin is backed up.
- SmartScreen/Defender scan; signed build preferred.
- No process remains on `:8910` after uninstall.

## 7. Known limitations

- Unsigned installer will trigger SmartScreen on other machines.
- The installer bundles ~200 MB (Node + mpv + yt-dlp).
- yt-dlp updates are not automatic; rebuild or update the bundled exe.
- mpv/yt-dlp licensing must be respected when redistributing.
- BetterDiscord guidelines do not allow this sidecar design in the official
  library; this is a private build.
