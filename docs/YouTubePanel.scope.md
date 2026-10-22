# YouTubePanel scope

Status: v0.3.0 standalone + stream extraction (2026-10-22)
Plugin: `YouTubePanel.plugin.js`
Dependencies: BetterDiscord only (no sidecar, mpv, yt-dlp, or Node server)

## 1. Purpose

A separate right-docked Discord panel that searches and plays YouTube / YouTube
Music without Spotify. It reuses the SpotifyPanel visual language and the
verified Discord music-bot bridge, but it is a separate plugin and separate
product.

v0.3.0 installs as one file, resolves audio through YouTube's `VISIONOS`
Innertube client, and plays it as a Blob through `<audio>`. The embedded player
remains the fallback.

## 2. Why standalone

The v0.1.x sidecar worked, but it required Node, yt-dlp, mpv, a `.cmd` launcher,
a localhost token, and a second process. That is too much install friction for a
"just copy the plugin" workflow.

The standalone build uses:

- `BdApi.Net.fetch` for search, oEmbed, the watch page, the Innertube player,
  and the resolved `googlevideo.com` bytes.
- A hidden `<audio>` + Blob URL for playback.
- `https://www.youtube.com/embed/<id>` in a hidden iframe as fallback.

Discord's CSP allows `media-src blob:` and `frame-src` for the embed, and
`BdApi.Net.fetch` bypasses the renderer's connect-src limits. No external
process is needed.

## 3. Architecture

```
Discord renderer (YouTubePanel.plugin.js)
  |-- BdApi.Net.fetch -> watch page + Innertube player + googlevideo
  |-- <audio> + Blob  -> resolved audio bytes
  |-- hidden iframe   -> youtube.com/embed/<id>       (fallback)
  '-- BdApi.Webpack   -> sendMessage (bot bridge)
```

The stream path makes YouTube treat the request as a first-party VISIONOS client
rather than an embed, so `playableInEmbed=false` is not applied. This is how
UMG/label-blocked videos play. The fallback iframe lives on `document.body`, so
hiding the panel does not unmount it.

## 4. In scope (v0.3.0)

- Public YouTube search (up to 20 results).
- Play a YouTube, YouTube Music, Shorts, or `youtu.be` URL.
- Add search results or URLs to the queue; jump, remove, clear.
- Transport: play/pause, next/previous, seek, volume, shuffle, repeat off/all/one,
  stop.
- Discord bot bridge: Jockie/JMusicBot/MusicBot/Custom profiles, left-click play
  with `{prefix}play {url}`, right-click command sheet, custom command.
- Panel settings: bot/channel, height, hotkey.
- Audio source setting: Auto (stream → embed), Stream, Embed.
- Stream extraction for label-blocked videos, with embed fallback.
- Embed-error and autoplay fallbacks.
- Mutual exclusion with SpotifyPanel and SideChat via `window.__jcodePanels`.
- Hotkey `Alt+Q` by default.

## 5. Out of scope (v0.3.0)

- Playlists. YouTube now uses `lockupViewModel`; a second parser is required.
- YouTube account login, liked songs, subscriptions, YT Music library.
- Private, members-only, age-restricted or purchased content.
- Video mode. Audio-only; Show video exists only as an autoplay fallback.
- Downloads or offline caching.
- Lyrics, podcasts, recommendations, autoplay.
- Any external process, localhost server, or bundled binary.
- Circumventing age gates, login requirements, DRM, or paid content.

## 6. Dependencies

- BetterDiscord with `BdApi.Net.fetch` (current PTB build has it).
- A working YouTube embed or extractable audio stream for the chosen video.
- No Node, yt-dlp, mpv, ffmpeg, or `.cmd` launcher.

## 7. Risks

- **ToS / ads:** stream extraction bypasses label embed blocks and ads. This is
  almost certainly a YouTube ToS violation and is not suitable for the official
  BetterDiscord library.
- **API fragility:** VISIONOS, the public Innertube key, `visitorData`, and
  direct URL formats can change. Fallbacks remain.
- **Embed restrictions:** if extraction fails, many music videos return error
  101/150 in the iframe; the panel offers Send to bot / Open on YouTube.
- **Autoplay policy:** Chromium can block sound until a gesture. Show video
  expands the iframe so the user can press YouTube's play button.
- **Search fragility:** YouTube's results HTML can change or show consent/captcha.
  URL playback remains available.
- **Memory:** stream mode fetches the full audio file into a Blob.
- **Background playback:** stream mode uses `<audio>` and is reliable; embed
  mode depends on Chromium keeping the offscreen iframe alive.
- **No playlists:** a known v0.3.0 regression from v0.1.x.
- **Discord reload:** BetterDiscord does not reliably hot-reload; toggle the
  plugin after replacing the file.

## 8. Phases

1. VISIONOS stream resolver + Blob `<audio>` engine.
2. Search and oEmbed metadata via `BdApi.Net.fetch`.
3. Queue, bot bridge, audio-source setting, embed fallback.
4. Tests: parser, queue, stream/audio events, fallback, live resolver.
5. Docs and one-file distribution.
6. Optional: MediaSource streaming, playlist parser, visible video toggle.

## 9. Open questions

- Add playlist support via `lockupViewModel`?
- Is bypassing label embed blocks acceptable for this product, given ToS/ads?
- Add MediaSource range streaming instead of full-file Blob fetch?
- Keep the legacy sidecar files in the repo, or move them to a `legacy/` folder?
