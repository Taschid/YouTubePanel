# YouTubePanel build log

Status: v0.5.1 (2026-10-22), packaged sidecar build
Plugin: `YouTubePanel.plugin.js`
Sidecar: `tools/youtube-sidecar/`
Tests: `.jcode-tests/YouTubePanel.lifecycle-test.js`
Installer: `installer/YouTubePanel.iss`, `installer/build.ps1`

## 1. What shipped

A separate right-docked Discord panel for YouTube / YouTube Music, plus a local
Node sidecar.

- **Player:** thumbnail, title, artist, progress, elapsed/total, play/pause,
  previous/next, seek, volume, shuffle, repeat, stop.
- **Search:** YouTube search (15 results), play or add to queue.
- **URLs:** play a YouTube/YouTube Music video URL, play a public playlist URL,
  or queue a playlist.
- **Queue:** current/upcoming rows, jump, remove, clear.
- **Settings:** sidecar URL/token + health, bot profile/prefix/templates,
  Discord channel id, height/hotkey in BD settings.
- **Discord bot:** left-click Send posts `{prefix}play <youtube-url>`; right-click
  opens the command sheet (play, pause, resume, skip, previous, repeat, shuffle,
  queue, now playing, stop, custom). Jockie/JMusicBot/MusicBot/Custom profiles.
- **Coexistence:** registers `window.__jcodePanels.youtube`; showing YouTube hides
  SpotifyPanel/SideChat, and startup hides the other panels so they never overlap.
  The left-edge guard is inside the panel, so it cannot be clicked through from
  the neighbouring panel. SpotifyPanel was only touched to apply the same
  startup mutual-exclusion rule.

## 2. Files

| Path | Purpose |
| --- | --- |
| `YouTubePanel.plugin.js` | single-file BetterDiscord panel |
| `tools/youtube-sidecar/sidecar.js` | HTTP API, yt-dlp + mpv control, queue/state |
| `tools/youtube-sidecar/lib.js` | pure metadata/queue helpers |
| `tools/youtube-sidecar/start-youtube-panel.cmd` | launcher + dependency check |
| `tools/youtube-sidecar/config.example.json` | port/token/paths/volume |
| `tools/youtube-sidecar/README.md` | setup and API reference |
| `.jcode-tests/YouTubePanel.lifecycle-test.js` | 50-assertion headless test |

## 3. Sidecar

- Binds `127.0.0.1:8910`, token `youtube-panel` by default.
- `yt-dlp` does `ytsearch15:`, single-video metadata (`--no-playlist`), playlist
  flattening (`--flat-playlist`) and stream resolution (`-g -f bestaudio/best`).
- `mpv` runs `--no-video --no-config --idle=yes --no-terminal` with a JSON IPC
  named pipe (`\\.\pipe\youtube-panel-mpv-<pid>`).
- Queue lives in the sidecar. `end-file` advances it; repeat one/off/all honored.
- Metadata fallback: `track`/`artist` are often empty on YouTube; the sidecar
  parses `Artist - Title`, strips `(Official Video/Audio/Lyrics/Remastered)`,
  strips ` - Topic` from uploaders, and uses `i.ytimg.com` thumbnails.
- mpv path auto-detection covers the winget install location when PATH is stale.
- Errors are returned as `{ error }` with HTTP 500; the panel shows them inline.

## 4. Panel behaviour

- Polls `/state` every 1s; interpolates progress every 500ms.
- Left-click Send: bot play with the current YouTube URL.
- Right-click Send: bot command sheet; result appears inside the sheet.
- Sidecar offline: inline error with the launcher path; settings has Test.
- Volume is persisted in plugin settings and pushed to mpv on first state load.
- Artwork uses the same width/height budget as SpotifyPanel: full-bleed
  `panelWidth - 48` in full-height mode, height-bound when manually resized.
- Cleanup: unregisters the panel and removes CSS/style on stop.

## 5. Setup

1. `winget install yt-dlp.yt-dlp`
2. `winget install shinchiro.mpv`
3. Run `tools/youtube-sidecar/start-youtube-panel.cmd`.
4. Enable **YouTubePanel** in BetterDiscord (hotkey `Alt+Q`).
5. Panel settings: set the music channel id and bot; test the sidecar.

## 6. Validation (2026-10-22)

- **Installer v0.5.0**: `YouTubePanel-Setup-0.5.0.exe` (72.4 MB) built with
  Inno Setup; bundled health returned mpv=true/yt-dlp 2026.10.21; MONSTER
  played; uninstall/reinstall and hidden auto-start path verified locally.
  See `YouTubePanel.installer.md` for the full evidence and remaining tests.
- **Slim installer v0.5.0**: `YouTubePanel-Setup-0.5.0-slim.exe` (2.8 MB)
  downloads Node/mpv/yt-dlp with pinned SHA-256 values; silent install,
  health, and MONSTER playback verified.
- `node --check` clean for plugin, sidecar and lib.
- **52 lifecycle assertions**: metadata normalization, hyphenated titles, queue
  next/previous/repeat/shuffle/remove, sidecar URL/method/body/token mapping,
  offline error, 448 path guidance, bot URL/query/prefix/raw/skip, missing
  channel/track/disabled play, BD settings, coexistence.
- **Headless Chrome real-React smoke**: panel mounted; title and times rendered;
  right-click bot sheet sent `m!skip`; search returned 2 rows; clicking a result
  sent `/play` for the right URL; settings showed 4 bot presets and the URL
  preview; queue showed 2 rows. No runtime errors.
- **Live sidecar**: `/health` mpv=true; `/search` returned 15 results; `/play`
  played Daft Punk - Around The World; `pause`, `seek 30`, `resume`, `next` and
  `stop` all changed state as expected. mpv 0.41.0, yt-dlp 2026.08.19.
- **CORS preflight**: `OPTIONS /play` from `https://discord.com` returns 204 with
  `Access-Control-Allow-Origin: *` and the token/content-type headers.
- **v0.5.1 installer path fallback**: a junction at
  `%LOCALAPPDATA%\YouTubePanel` was rejected and setup installed to
  `C:\Users\Public\YouTubePanel`; `/health` returned true and MONSTER played.
  The normal LocalAppData path also installs without UAC.
- **v0.5.1 yt-dlp hardening**: calls now use `--ignore-config --no-cache-dir`
  with a stable working directory; playback and `/health` still pass.

## 7. Known limitations

- Public content only; no account login, liked songs, subscriptions or private
  playlists.
- Audio-only; no video.
- yt-dlp and mpv are external dependencies; updates can break extraction.
- yt-dlp stream extraction is a YouTube ToS gray area; personal/local use only.
- No packaged sidecar exe yet; launcher + Node/winget dependencies for v1.
- Thumbnail host may be blocked by a strict theme; sidecar proxy is the fallback.
- BetterDiscord does not hot-reload; toggle the plugin after updating.

## 8. Next steps

- Package the sidecar as a single exe and bundle/point to yt-dlp + mpv.
- Optional cookies for age-restricted/private content and YT Music library.
- Sidecar thumbnail proxy for CSP-restricted themes.
- Optional bulk "send queue to bot" action.
- Decide whether to offer an official IFrame fallback for ToS-sensitive users.

## 8. Version history

- **0.5.1**: safe install-folder probe with Public fallback, no UAC; yt-dlp
  config/cache isolation; 448 guidance in the panel.
- **0.1.1**: hotkey moved from Alt+Y to Alt+Q (existing Alt+Y configs migrate
  on load), Spotify-matched artwork sizing, inside-panel left-edge guard, and
  startup mutual exclusion so right-column panels do not overlap.
- **0.1.0**: initial YouTubePanel + yt-dlp/mpv sidecar.
