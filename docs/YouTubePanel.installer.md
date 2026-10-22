# YouTubePanel sidecar installer

Status: v0.5.1 (2026-10-22)
Product: `YouTubePanel-Setup-0.5.1.exe` (offline) and
`YouTubePanel-Setup-0.5.1-slim.exe` (2.8 MB downloader)
Plugin: sidecar build restored from `youtubepanel-sidecar-v0.1.1`
Sidecar: `tools/youtube-sidecar/`

## 1. What the installer does

One per-user Windows installer for the sidecar build:

- Probes `%LOCALAPPDATA%\YouTubePanel` before installing.
- Falls back to `C:\Users\Public\YouTubePanel` when LocalAppData is a
  junction, a OneDrive/cloud path, or not writable. No admin/UAC prompt.
- Refuses unsafe paths instead of installing into a folder Windows 448 blocks.
- Offline build bundles Node, yt-dlp, mpv and the sidecar JS.
- Slim build downloads Node, yt-dlp and mpv once during setup, checks pinned
  SHA-256 values, then installs the same layout.
- Copies `YouTubePanel.plugin.js` into
  `%APPDATA%\BetterDiscord\plugins`.
- Backs up an existing plugin as `.plugin.js.bak`.
- Merges `sidecarUrl`/`sidecarToken` into `YouTubePanel.config.json` without
  destroying bot/channel settings.
- Removes the obsolete `youtubeCookie` and `audioSource` settings.
- Enables `YouTubePanel` in each detected
  `%APPDATA%\BetterDiscord\data\<branch>\plugins.json`.
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
powershell -ExecutionPolicy Bypass -File installer\build.ps1 -Version 0.5.1
```

Optional overrides:

```powershell
-MpvPath "C:\path\mpv.exe"
-NodePath "C:\path\node.exe"
-YtDlpPath "C:\path\yt-dlp.exe"
```

Output: `installer\output\YouTubePanel-Setup-0.5.1.exe`.

### 3.1 Slim build

```powershell
powershell -ExecutionPolicy Bypass -File installer\slim\build-slim.ps1 -Version 0.5.1
```

Output: `installer\output\YouTubePanel-Setup-0.5.1-slim.exe`.

The slim installer downloads:

- `node-v24.19.0-win-x64.zip`
- `mpv-x86_64-20261021-git-e471496c56.7z`
- `yt-dlp.exe` 2026.10.21

Each download has a pinned SHA-256 in `YouTubePanel-slim.iss`. The installed
tree (including runtime versions and paths) is the same as the offline build.
The installer itself drops from about 72 MB to 2.8 MB, but setup needs network
access and downloads about 82 MB.

Build artifacts (`installer/build`, `installer/output`) are intentionally not
committed.

## 4. Install flow

1. Inno Setup chooses the first safe install folder:
   `%LOCALAPPDATA%\YouTubePanel`, then `C:\Users\Public\YouTubePanel`.
   A folder is rejected if it is a reparse point, under OneDrive, or fails a
   write probe. `UsePreviousAppDir=no` prevents an old path from overriding
   this choice.
2. Stops an older sidecar and backs up the old plugin.
3. Extracts runtime/binaries and copies the plugin.
4. Merges the sidecar URL/token into the plugin config.
   Also enables the plugin in BetterDiscord's `plugins.json`.
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

Tested locally on 2026-10-22 (v0.5.1):

- Installer exit code 0 with `/VERYSILENT`; no admin.
- Installed tree present under `%LOCALAPPDATA%\YouTubePanel`.
- `/health` returned `mpv: true`, yt-dlp `2026.10.21`, port 8910.
- Destroy Lonely - MONSTER played through the bundled sidecar and stopped
  after the yt-dlp `--ignore-config --no-cache-dir` change.
- Plugin copied to `%APPDATA%\BetterDiscord\plugins\YouTubePanel.plugin.js`,
  header `@version 0.5.1`.
- Config merge kept `musicChannelId`, removed `youtubeCookie` and
  `audioSource`, added `sidecarUrl`/`sidecarToken`, and set
  `"YouTubePanel": true` in `data/ptb/plugins.json`.
- `stop-sidecar.ps1` removed node, mpv, `sidecar.pid`, and the `:8910`
  listener.
- The HKCU Run command started the sidecar hidden; `/health` returned true.
- Uninstall removed the install tree, plugin, Run key, and `:8910` listener;
  `YouTubePanel.config.json` remained.
- Reinstall after uninstall succeeded and restored health.
- Simulated untrusted mount point: a junction at
  `%LOCALAPPDATA%\YouTubePanel` was rejected; setup automatically installed
  to `C:\Users\Public\YouTubePanel`, `/health` returned true, and MONSTER
  played. Uninstall removed the fallback install and Run key.
- Restored the normal LocalAppData path and reinstalled 0.5.1; `/health`
  returned true with no UAC prompt.
- Slim installer: 2.8 MB output, silent install exit 0, downloaded and
  verified all three payloads, and installed `node v24.19.0`,
  `mpv v0.41.0-1227-ge471496c5`, and `yt-dlp 2026.10.21`.
- Offline installer is 71.1 MB after dropping `d3dcompiler_43.dll`; audio
  playback was rechecked without the DLL.
- Slim `/health` returned `mpv: true`; MONSTER played with position and
  duration 160.

Still required before calling it distribution-ready:

- Fresh Windows user profile or VM install.
- Discord in-client check: Alt+Q opens the panel, MONSTER/UMG plays, transport
  works, sidecar survives a Discord restart.
- Upgrade-over-existing test with a running old sidecar.
- Code signing and Defender/SmartScreen scan on a downloaded copy.
- Windows login/logout auto-start test (Run command was tested directly).

## 7. Known limitations

- Unsigned installer will trigger SmartScreen on other machines.
- The offline installer bundles ~246 MB of runtime (about 72 MB compressed).
  The slim installer is 2.8 MB but downloads ~82 MB during setup.
- No machine-wide or UAC install mode. If both LocalAppData and Public fail,
  setup stops with an explicit path error.
- `d3dcompiler_43.dll` is not bundled; audio-only playback was verified
  without it. Keep the DLL if video output is added later.
- yt-dlp updates are not automatic; rebuild or update the bundled exe.
- mpv/yt-dlp licensing must be respected when redistributing.
- BetterDiscord guidelines do not allow this sidecar design in the official
  library; this is a private build.
