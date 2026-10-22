# YouTubePanel scope

Status: v0.2.0 standalone (2026-10-22)
Plugin: `YouTubePanel.plugin.js`
Dependencies: BetterDiscord only (no sidecar, mpv, yt-dlp, or Node server)

## 1. Purpose

A separate right-docked Discord panel that searches and plays YouTube / YouTube
Music without Spotify. It reuses the SpotifyPanel visual language and the
verified Discord music-bot bridge, but it is a separate plugin and separate
product.

v0.2.0 installs as one file and uses YouTube's own embedded player for audio.

## 2. Why standalone

The v0.1.x sidecar worked, but it required Node, yt-dlp, mpv, a `.cmd` launcher,
a localhost token, and a second process. That is too much install friction for a
"just copy the plugin" workflow.

The standalone build uses:

- `https://www.youtube.com/embed/<id>` in a hidden iframe for playback.
- `BdApi.Net.fetch` for search and oEmbed metadata.
- `postMessage` for play/pause/seek/volume and `infoDelivery` state.

Discord's CSP already allows `https://www.youtube.com/embed/`, and BetterDiscord
already exposes `BdApi.Net.fetch`, so no external process is needed.

## 3. Architecture

```
Discord renderer (YouTubePanel.plugin.js)
  |-- BdApi.Net.fetch -> youtube.com/results + oembed  (search/metadata)
  |-- hidden iframe   -> youtube.com/embed/<id>       (audio)
  |-- postMessage     -> listening / command / infoDelivery
  '-- BdApi.Webpack   -> sendMessage (bot bridge)
```

The iframe lives on `document.body`, not inside the panel, so hiding the panel
does not unmount playback. It is 2x2 with opacity `0.01`; Chrome/Electron keep
playing audio at that size.

## 4. In scope (v0.2.0)

- Public YouTube search (up to 20 results).
- Play a YouTube, YouTube Music, Shorts, or `youtu.be` URL.
- Add search results or URLs to the queue; jump, remove, clear.
- Transport: play/pause, next/previous, seek, volume, shuffle, repeat off/all/one,
  stop.
- Discord bot bridge: Jockie/JMusicBot/MusicBot/Custom profiles, left-click play
  with `{prefix}play {url}`, right-click command sheet, custom command.
- Panel settings: bot/channel, height, hotkey.
- Embed-error and autoplay fallbacks.
- Mutual exclusion with SpotifyPanel and SideChat via `window.__jcodePanels`.
- Hotkey `Alt+Q` by default.

## 5. Out of scope (v0.2.0)

- Playlists. YouTube now uses `lockupViewModel`; a second parser is required.
- YouTube account login, liked songs, subscriptions, YT Music library.
- Private, members-only, age-restricted or purchased content.
- Video mode. Audio-only; Show video exists only as an autoplay fallback.
- Downloads or offline caching.
- Lyrics, podcasts, recommendations, autoplay.
- Any external process, localhost server, or bundled binary.

## 6. Dependencies

- BetterDiscord with `BdApi.Net.fetch` (current PTB build has it).
- A working YouTube embed for the chosen video.
- No Node, yt-dlp, mpv, ffmpeg, or `.cmd` launcher.

## 7. Risks

- **Embed restrictions:** many music videos return error 101/150 and cannot play
  in an iframe. The panel surfaces this and offers Open on YouTube.
- **Autoplay policy:** Chromium can block sound until a gesture. Show video
  expands the iframe so the user can press YouTube's play button.
- **Search fragility:** YouTube's results HTML can change or show consent/captcha.
  URL playback remains available.
- **Ads:** YouTube may play ads; the panel cannot skip them.
- **Background playback:** hiding the panel is intended to keep audio, but
  YouTube/Chromium may pause offscreen media.
- **ToS:** embedding the standard YouTube player is the least invasive option,
  but background/audio-only use is still a YouTube ToS gray area.
- **No playlists:** a known v0.2.0 regression from v0.1.x.
- **Discord reload:** BetterDiscord does not reliably hot-reload; toggle the
  plugin after replacing the file.

## 8. Phases

1. Standalone iframe engine + handshake + transport.
2. Search and oEmbed metadata via `BdApi.Net.fetch`.
3. Queue, bot bridge, settings, fallbacks.
4. Tests: parser, queue, iframe commands, live search, headless embed.
5. Docs and one-file distribution.
6. Optional: playlist parser, visible video toggle, search cache.

## 9. Open questions

- Add playlist support via `lockupViewModel`?
- Should Show video become a first-class setting instead of only an autoplay
  fallback?
- Keep the legacy sidecar files in the repo, or move them to a `legacy/` folder?
- Filter search results that are known to be embed-restricted, or let the user
  discover the error?
