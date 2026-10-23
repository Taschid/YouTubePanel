# YouTubePanel

A docked YouTube / YouTube Music controller for Discord, built as a
[BetterDiscord](https://betterdiscord.app/) plugin with a local Node sidecar
that does the actual search and playback.

The plugin is pure UI plus `fetch`. A loopback-only sidecar wraps
[`yt-dlp`](https://github.com/yt-dlp/yt-dlp) for search/metadata and
[`mpv`](https://mpv.io/) for audio, so nothing heavy runs inside the Discord
renderer.

![status](https://img.shields.io/badge/version-0.5.3-informational)

## Features

- **Player panel** docked to the right edge: thumbnail, title, artist, progress,
  elapsed/total, play/pause, previous/next, seek, volume, shuffle, repeat, stop.
- **Search:** YouTube search (15 results) with play or add-to-queue.
- **URLs:** play a YouTube or YouTube Music video URL, play a public playlist,
  or queue one.
- **Queue:** current and upcoming rows with jump, remove and clear.
- **Discord bot bridge:** left-click Send posts `{prefix}play <youtube-url>` to a
  music channel; right-click opens a command sheet (play, pause, resume, skip,
  previous, repeat, shuffle, queue, now playing, stop, custom).
  Profiles for Jockie, JMusicBot, MusicBot and custom prefixes.
- **Panel coexistence:** registers `window.__jcodePanels.youtube` and hides the
  neighbouring panels so they never overlap.
- **Installer:** per-user EXE with bundled Node, `yt-dlp` and `mpv`, a free-port
  picker, startup entry, self-tests and an uninstaller.

## Requirements

Windows 10/11 for the installer. For a manual install:

- BetterDiscord (PTB or stable)
- Node.js 20+
- `yt-dlp` on `PATH` (`winget install yt-dlp.yt-dlp`)
- `mpv` (`winget install shinchiro.mpv`)

## Install

### Installer (recommended)

Build or grab `YouTubePanel-Setup-<version>.exe`, run it, and restart Discord.
Setup installs the plugin, bundles the runtime, picks a free port in
8910-8999, keeps `YouTubePanel.config.json` in sync and starts the sidecar at
login. Uninstall removes the plugin, sidecar and startup entry without touching
`PATH`.

### Manual

```bat
copy YouTubePanel.plugin.js "%APPDATA%\BetterDiscord\plugins\"
cd tools\youtube-sidecar
start-youtube-panel.cmd
```

Then enable **YouTubePanel** in BetterDiscord settings. Press `Alt+Q` to toggle
the panel; the hotkey and panel height are configurable in BD settings.

The sidecar listens on `http://127.0.0.1:8910` with the token header
`X-Panel-Token: youtube-panel` by default. Change the token in `config.json` and
paste the same value into the panel's Settings screen.

## Repo layout

| Path | Purpose |
| --- | --- |
| `YouTubePanel.plugin.js` | single-file BetterDiscord panel |
| `tools/youtube-sidecar/sidecar.js` | loopback HTTP API, yt-dlp + mpv control, queue/state |
| `tools/youtube-sidecar/lib.js` | pure metadata and queue helpers |
| `tools/youtube-sidecar/start-youtube-panel.cmd` | launcher with dependency check |
| `installer/` | Inno Setup script, payload scripts and build scripts |
| `.jcode-tests/` | headless lifecycle and live-search test harnesses |
| `docs/` | build log, installer notes, scope and legacy spec |

## Sidecar API

All routes require the token except `OPTIONS` preflight.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/health` | mpv / yt-dlp status |
| GET | `/state` | current track, position, duration, queue, repeat/shuffle |
| GET | `/search?q=` | YouTube search |
| GET | `/queue` | queue snapshot |
| POST | `/play` | `{ url }` or `{ query }` |
| POST | `/playlist` | `{ url }` |
| POST | `/queue/add` | `{ url }` or `{ query }` |
| POST | `/queue/remove` | `{ index }` |
| POST | `/jump` | `{ index }` |
| POST | `/pause`, `/resume`, `/next`, `/previous` | transport |
| POST | `/seek` | `{ seconds }` |
| POST | `/volume` | `{ percent }` |
| POST | `/shuffle`, `/repeat`, `/stop`, `/clear` | queue and playback |

## Build the installer

```powershell
cd installer
.\build.ps1 -Version 0.5.3
```

The script locates Node, `mpv` and Inno Setup (`ISCC.exe`), stages the payload,
downloads `yt-dlp.exe`, records `about.txt` and license texts, then compiles
`output\YouTubePanel-Setup-0.5.3.exe`. `installer\slim\build-slim.ps1` builds
the smaller variant that downloads the runtime at install time.

## Tests

```bat
node .jcode-tests\YouTubePanel.lifecycle-test.js
node .jcode-tests\YouTubePanel.live-search-test.js
```

The lifecycle test runs headless against the plugin logic. The live-search test
needs a running sidecar plus network access.

## Troubleshooting

- **Panel shows "sidecar offline"** - run `start-youtube-panel.cmd`, then
  `curl http://127.0.0.1:8910/health -H "X-Panel-Token: youtube-panel"`.
- **Playback errors on one video** - `yt-dlp` breaks when YouTube changes;
  update it with `yt-dlp -U`.
- **Panel does not appear** - only `*.plugin.js` files are loaded from the BD
  plugins folder; toggle the plugin off and on after updating.
- **Port already in use** - change `port` in `config.json` and update
  `sidecarUrl` in the plugin settings.

## Limitations

- Public search, public videos and public playlists only. Private, age-gated and
  YouTube Music library content need cookies and are out of scope for 0.5.x.
- Windows only for the packaged installer.

## Disclaimer

This project is not affiliated with YouTube, Google, Discord or BetterDiscord.
It uses third-party tools to play publicly available media; respect the terms
of service of the platforms you use it with.
