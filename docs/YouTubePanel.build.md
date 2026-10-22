# YouTubePanel build log

Status: v0.2.0 (2026-10-22), standalone
Plugin: `YouTubePanel.plugin.js`
Sidecar: none (legacy files remain in `tools/youtube-sidecar/`)
Tests: `.jcode-tests/YouTubePanel.lifecycle-test.js`,
`.jcode-tests/YouTubePanel.live-search-test.js`

## 1. What shipped

A separate right-docked Discord panel for YouTube / YouTube Music that installs
as **one file**. No Node sidecar, no `start-youtube-panel.cmd`, no mpv, no
yt-dlp, and no localhost server.

- **Playback:** YouTube's embedded player in a 2x2 hidden iframe. Audio only.
- **Search:** YouTube's public results page, fetched through `BdApi.Net.fetch`
  and parsed from `ytInitialData`.
- **Metadata:** YouTube oEmbed for title, channel and thumbnail.
- **URLs:** play a YouTube / YouTube Music / Shorts / `youtu.be` URL.
- **Queue:** play, add, next/previous, jump, remove, clear, shuffle, repeat
  off/all/one.
- **Transport:** play/pause, seek, volume, stop.
- **Discord bot:** left-click Send posts `{prefix}play <youtube-url>`;
  right-click opens the command sheet. Jockie/JMusicBot/MusicBot/Custom.
- **Settings:** bot/channel, height, hotkey. No sidecar fields.
- **Fallbacks:** embed-restricted videos (error 101/150) show a clear message
  and an Open on YouTube action. If autoplay is blocked, Show video expands the
  iframe so the user can press YouTube's play button.

No playlists in v0.2.0. YouTube now serves playlist items as `lockupViewModel`,
so that needs a second parser.

## 2. Files

| Path | Purpose |
| --- | --- |
| `YouTubePanel.plugin.js` | the entire standalone plugin |
| `.jcode-tests/YouTubePanel.lifecycle-test.js` | 80-assertion offline test |
| `.jcode-tests/YouTubePanel.live-search-test.js` | optional live search + oEmbed check |
| `tools/youtube-sidecar/` | legacy v0.1.x sidecar; unused by v0.2.0 |

## 3. Architecture

```
Discord renderer (YouTubePanel.plugin.js)
  |-- BdApi.Net.fetch -> youtube.com/results + oembed  (search/metadata)
  |-- hidden iframe   -> youtube.com/embed/<id>       (audio)
  |-- postMessage     -> listening / command / infoDelivery
  '-- BdApi.Webpack   -> sendMessage (bot bridge, unchanged)
```

The iframe host is appended to `document.body`, outside the panel, so hiding
the panel does not stop playback. It is a 2x2 element with opacity `0.01`;
YouTube initializes and plays normally at that size (verified in headless
Chrome).

### iframe protocol

YouTube needs a listening handshake before it sends player events:

```js
{ event: "listening", id: playerId, channel: "widget" }
{ event: "command", func: "playVideo", args: [], id: playerId, channel: "widget" }
```

Commands used: `playVideo`, `pauseVideo`, `stopVideo`, `seekTo`, `setVolume`.
Events handled: `initialDelivery`, `infoDelivery`, `onReady`,
`alreadyInitialized`, `onError`.

## 4. Panel behaviour

- Polls `engine.snapshot()` every 1s; interpolates progress every 500ms.
- Left-click Send: bot play with the current YouTube URL.
- Right-click Send: bot command sheet.
- Volume is persisted in plugin settings and pushed on first `infoDelivery`.
- Search results are cached for 2 minutes; repeated Go presses do not refetch.
- A stalled autoplay (no playing/buffering state within 4.5s) sets `blocked` so
  the Show video fallback appears.
- v0.1.x sidecar config keys are deleted and the cleaned settings are saved.
- Artwork uses the same width/height budget as SpotifyPanel.
- Cleanup: removes the iframe, message listener, timers, panel, CSS and
  registry entry on stop.

## 5. Setup

1. Put `YouTubePanel.plugin.js` in `%APPDATA%\BetterDiscord\plugins`.
2. Enable **YouTubePanel** in BetterDiscord (hotkey `Alt+Q`).
3. Panel settings: set the music channel id and bot.
4. Search, or paste a YouTube URL. Press Play.

No extra install step.

## 6. Validation (2026-10-22)

- `node --check YouTubePanel.plugin.js` clean.
- **80 lifecycle assertions**: URL parsing, duration parsing, `ytInitialData`
  search parsing, queue semantics, settings migration, iframe URL/commands,
  listening handshake, `infoDelivery` state, seek/volume, repeat, embed error,
  bot URL/query/prefix/raw/skip, missing channel/track/disabled play, BD
  settings, coexistence.
- **Live search**: `searchYouTube("daft punk around the world")` returned 15+
  results; oEmbed resolved title and thumbnail.
- **Headless Chrome**: a real YouTube embed initialized at 2x2 and emitted
  `initialDelivery`, `onReady`, `infoDelivery`, and `apiInfoDelivery` after the
  listening handshake. `isPlayable:true`, `duration:1344`, player state 3
  (buffering).
- **Embed restriction**: `K0HSD_i2DvA` returned `onError:150` and
  `isPlayable:false`; the plugin reports "owner does not allow embedded
  playback" and offers Open on YouTube.
- **CSP evidence**: Discord stable/PTB `frame-src` includes
  `https://www.youtube.com/embed/`; `img-src` includes `https://i.ytimg.com`.
- **No sidecar**: no `localhost`, `8910`, `mpv`, `yt-dlp`, or `.cmd` references
  remain in the plugin.

## 7. Known limitations

- **Embed-restricted videos** cannot play. Music labels often disable embedding;
  error 101/150 is surfaced with an Open on YouTube action.
- **UMG/label blocks**: if the player never delivers info, the panel says the
  video may be blocked from embeds and offers **Send to bot** as well as Open on
  YouTube.
- **Autoplay** can be blocked by Chromium. Show video expands the player so the
  user can click YouTube's play button.
- **Autoplay strategy**: the iframe starts with `mute=1` (muted autoplay is
  always allowed), then sends `unMute` and `setVolume` after
  `initialDelivery`. Chrome still blocks that automatic unmute, so if it is
  still muted after 2s the panel shows Enable sound. That button sends
  `unMute` inside a real click and expands the video only if that fails.
- **YouTube HTML changes** can break search parsing. URL playback still works.
- **Consent/captcha pages** can block search depending on region/IP.
- **Ads** may play before or during a video.
- **No playlists** in v0.2.0.
- **No account**; private, age-restricted, members-only and purchased content
  is unavailable.
- **Audio-only**; no video mode (Show video is a fallback, not a feature).
- **Background playback** depends on Chromium keeping the offscreen iframe
  alive; hiding the panel is intended to keep audio playing but is not
  guaranteed by YouTube.
- **BetterDiscord does not reliably hot-reload**; toggle the plugin after
  replacing the file.

## 8. Next steps

- Add `lockupViewModel` playlist parsing.
- Add a visible video toggle that is a first-class setting, not only a fallback.
- Cache search results briefly and add a spinner state.
- Consider filtering embed-restricted results when YouTube exposes that flag.
- Optionally provide a command-only "lite" build for users who do not want an
  iframe.

## 9. Version history

- **0.2.0**: standalone rewrite. Removed the sidecar; added iframe playback,
  `BdApi.Net.fetch` search, oEmbed metadata, listening handshake, autoplay and
  embed-error fallbacks; one-file install.
- **0.1.1**: hotkey moved from Alt+Y to Alt+Q, Spotify-matched artwork sizing,
  inside-panel left-edge guard, startup mutual exclusion.
- **0.1.0**: initial YouTubePanel + yt-dlp/mpv sidecar.
