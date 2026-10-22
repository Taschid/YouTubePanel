# YouTubePanel scope

Status: v0.5.0, packaged sidecar build (2026-10-22)
Plugin: `YouTubePanel.plugin.js`
Sidecar: `tools/youtube-sidecar/`

## 1. Purpose

A separate right-docked Discord panel that searches and plays YouTube / YouTube
Music audio without Spotify. It reuses the SpotifyPanel visual language and the
verified Discord music-bot bridge, but it is a separate plugin and separate
product. `SpotifyPanel` is unchanged.

## 2. Why a separate plugin

`SpotifyPanel` is a 3,500-line single file with 34 Spotify-specific API calls in
its App. Retrofitting a source toggle would touch auth, player state, library,
devices and transport. A fork keeps the Spotify product stable and lets the
YouTube product choose its own backend, settings and failure modes.

## 3. Architecture

```
Discord renderer (YouTubePanel.plugin.js)
        |  HTTP, 127.0.0.1:8910, X-Panel-Token
        v
Node sidecar (tools/youtube-sidecar/sidecar.js)
        |  execFile                         |  JSON IPC over a named pipe
        v                                   v
     yt-dlp                              mpv --no-video
  search / metadata / playlist       audio, pause, seek, volume
```

The renderer has no Node builtins. It only uses `fetch`; the sidecar owns all
process and filesystem access. This matches the verified BetterDiscord sandbox
constraints in `docs/SpotifyPanel.scope.md`.

## 4. In scope (v1)

- Public YouTube search (`ytsearch`, 15 results).
- Play a video by YouTube or YouTube Music URL.
- Play a public playlist by URL (flat playlist -> queue).
- Add a video/playlist to the queue; jump, remove, clear.
- Transport: play/pause, next/previous, seek, volume, shuffle, repeat off/all/one,
  stop.
- Discord music-bot bridge: Jockie/JMusicBot/MusicBot/Custom profiles, left-click
  play using `{prefix}play {url}`, right-click command sheet, custom command.
- Panel settings: sidecar URL/token, health, bot profile/prefix/templates, channel
  id, height/hotkey (BD settings).
- Mutual exclusion with SpotifyPanel and SideChat via `window.__jcodePanels`.
- Hotkey `Alt+Q` by default.

## 5. Out of scope (v1)

- YouTube account login, liked songs, subscriptions, YT Music library.
- Private, members-only, age-restricted or purchased content (cookies deferred).
- Video playback; audio-only by design.
- Downloads or offline caching.
- Lyrics, podcasts, recommendations, autoplay.
- Bundling yt-dlp/mpv into an installer; v1 uses winget/PATH dependencies.

## 6. Dependencies

- Node 20+ (tested 24.19)
- yt-dlp (tested 2026.08.19)
- mpv (tested 0.41.0 via `shinchiro.mpv`)
- ffmpeg (already present; yt-dlp/mpv use it for some formats)

The sidecar auto-detects `C:\Program Files\MPV Player\mpv.exe` when `mpv` is not
on the current PATH.

## 7. Risks

- **YouTube ToS / yt-dlp:** extracting stream URLs is a gray area. This is a
  local, personal-use product; do not redistribute streams or bundle media.
  Decide whether the product ships with this posture or moves to the official
  IFrame player (weaker background playback).
- **yt-dlp breakage:** YouTube changes often; the sidecar surfaces yt-dlp errors.
  Update with `yt-dlp -U`/winget.
- **mpv dependency:** install friction on new machines; launcher checks and
  prints the winget command.
- **Localhost security:** token is a shared local secret; bind to 127.0.0.1 only.
- **Thumbnail CSP:** external `i.ytimg.com` images may be blocked in some themes;
  a sidecar thumbnail proxy is the fallback.
- **Discord reload:** BetterDiscord does not hot-reload plugins.

## 8. Phases

1. Sidecar: yt-dlp search/metadata/stream, mpv IPC, queue and transport.
2. Panel: now playing, search, queue, settings, sidecar health.
3. Bot bridge: profiles, URL play, command sheet, custom command.
4. Playlists and queue jump/remove.
5. Tests: sidecar library, panel lifecycle, headless React UI, live playback.
6. Distribution: launcher + config example; packaged sidecar exe later.
7. Optional: cookies/library, thumbnail proxy, packaged dependencies.

## 9. Open questions

- Ship mpv/yt-dlp inside an installer or keep winget dependencies?
- Add account cookies/liked songs, or stay public-only?
- Default bot play: YouTube URL (current) vs title+artist query?
- Official IFrame mode for ToS-sensitive users?
- Single sidecar for both panels, or per-product sidecars?
