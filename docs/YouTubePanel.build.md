# YouTubePanel build log

Status: v0.3.0 (2026-10-22), standalone + stream extraction
Plugin: `YouTubePanel.plugin.js`
Sidecar: none (legacy files remain in `tools/youtube-sidecar/`)
Tests: `.jcode-tests/YouTubePanel.lifecycle-test.js`,
`.jcode-tests/YouTubePanel.live-search-test.js`

## 1. What shipped

A separate right-docked Discord panel for YouTube / YouTube Music that installs
as **one file**. No Node sidecar, no `start-youtube-panel.cmd`, no mpv, no
yt-dlp, and no localhost server.

- **Playback:** default path resolves the audio stream through YouTube's
  `VISIONOS` Innertube client, fetches it with `BdApi.Net.fetch`, and plays it
  as a Blob through `<audio>`. The 2x2 embed iframe remains the fallback.
- **Search:** YouTube's public results page, fetched through `BdApi.Net.fetch`
  and parsed from `ytInitialData`.
- **Metadata:** YouTube oEmbed for title, channel and thumbnail.
- **URLs:** play a YouTube / YouTube Music / Shorts / `youtu.be` URL.
- **Queue:** play, add, next/previous, jump, remove, clear, shuffle, repeat
  off/all/one.
- **Transport:** play/pause, seek, volume, stop.
- **Discord bot:** left-click Send posts `{prefix}play <youtube-url>`;
  right-click opens the command sheet. Jockie/JMusicBot/MusicBot/Custom.
- **Settings:** audio source (`Auto`, `Stream`, `Embed`), bot/channel, height,
  hotkey. No sidecar fields.
- **Label-blocked videos:** stream extraction plays UMG/embed-blocked videos
  in-panel. If extraction fails, the embed iframe is used, then Send to bot /
  Open on YouTube.

No playlists in v0.3.0. YouTube now serves playlist items as `lockupViewModel`,
so that needs a second parser.

## 2. Files

| Path | Purpose |
| --- | --- |
| `YouTubePanel.plugin.js` | the entire standalone plugin |
| `.jcode-tests/YouTubePanel.lifecycle-test.js` | 100-assertion offline test |
| `.jcode-tests/YouTubePanel.live-search-test.js` | live search, oEmbed, stream resolver, byte fetch |
| `tools/youtube-sidecar/` | legacy v0.1.x sidecar; unused by v0.3.0 |

## 3. Architecture

```
Discord renderer (YouTubePanel.plugin.js)
  |-- BdApi.Net.fetch -> watch page + Innertube player + googlevideo (stream)
  |-- <audio> + Blob  -> resolved audio bytes
  |-- hidden iframe   -> youtube.com/embed/<id>       (fallback)
  '-- BdApi.Webpack   -> sendMessage (bot bridge, unchanged)
```

### Stream extraction

1. Fetch `youtube.com/watch?v=<id>&hl=en`, extract `visitorData`.
2. POST to `/youtubei/v1/player` with the `VISIONOS` client context:
   `clientName: VISIONOS`, `clientVersion: 1.02`, Apple device fields,
   `X-Goog-Visitor-Id`, `X-Goog-Api-Format-Version: 2`.
3. Pick AAC `itag 140` (fallback 251/139) from `streamingData.adaptiveFormats`.
4. Fetch the direct `googlevideo.com` URL through `BdApi.Net.fetch`.
5. Build a Blob URL and play it through a hidden `<audio>` element.

The `VISIONOS` client ignores the publisher's `playableInEmbed` flag. This is
why UMG/label-blocked videos work. It also bypasses ads, which is a ToS risk.

### Embed fallback

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
- Audio source `Auto` tries stream extraction, then falls back to the embed.
- Stream path keeps one hidden `<audio>` element; Blob URLs are revoked on
  track change, stop, and reload.
- Volume is persisted and applied directly to `<audio>` or via iframe commands.
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
3. Panel settings: choose Audio source (`Auto` by default), set the music
   channel id and bot.
4. Search, or paste a YouTube URL. Press Play.

No extra install step.

## 6. Validation (2026-10-22)

- `node --check YouTubePanel.plugin.js` clean.
- **100 lifecycle assertions**: URL parsing, duration parsing, `ytInitialData`
  search parsing, queue semantics, settings migration, iframe URL/commands,
  listening handshake, `infoDelivery` state, VISIONOS request/headers,
  stream/audio events, stream-to-embed fallback, seek/volume, repeat, embed
  error, bot URL/query/prefix/raw/skip, missing channel/track/disabled play,
  BD settings, coexistence.
- **Live search**: `searchYouTube("daft punk around the world")` returned 15+
  results; oEmbed resolved title and thumbnail.
- **Live stream resolver**: the UMG-blocked `K0HSD_i2DvA` returned `OK` and
  AAC `itag 140` (`contentLength` 3.9 MB); a ranged byte fetch succeeded.
- **Headless Chrome**: a real YouTube embed initialized at 2x2 and emitted
  `initialDelivery`, `onReady`, `infoDelivery`, and `apiInfoDelivery` after the
  listening handshake. `isPlayable:true`, `duration:1344`, player state 3
  (buffering).
- **Embed restriction**: `K0HSD_i2DvA` returns `onError:150` in the iframe;
  the stream path plays it instead.
- **CSP evidence**: Discord stable/PTB `frame-src` includes
  `https://www.youtube.com/embed/`; `img-src` includes `https://i.ytimg.com`.
- **No sidecar**: no `localhost`, `8910`, `mpv`, `yt-dlp`, or `.cmd` references
  remain in the plugin.

## 7. Known limitations

- **ToS / ads**: stream extraction bypasses label embed blocks and ads. This is
  almost certainly a YouTube ToS violation and is not suitable for the official
  BetterDiscord library.
- **API fragility**: the VISIONOS client, public Innertube key, `visitorData`,
  and direct URL format can change without notice. The embed/Open fallbacks
  remain.
- **Memory**: the full audio file is fetched into a Blob (about 1-4 MB per
  song). Blob URLs are revoked on change.
- **Age/private/login**: resolver returns `LOGIN_REQUIRED`; the panel falls back
  to the embed and then Open on YouTube.
- **Embed-restricted videos** still fail in the embed fallback; the stream path
  is what plays them.
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
- **No playlists** in v0.3.0.
- **No account**; private, age-restricted, members-only and purchased content
  is unavailable.
- **Audio-only**; no video mode (Show video is a fallback, not a feature).
- **Background playback** depends on Chromium keeping the offscreen iframe
  alive in embed mode. Stream mode uses `<audio>`, which is more reliable.
- **BetterDiscord does not reliably hot-reload**; toggle the plugin after
  replacing the file.

## 8. Next steps

- Add `lockupViewModel` playlist parsing.
- Add MediaSource range streaming to avoid full-file memory use.
- Add resolver client fallbacks (VISIONOS → other non-embed clients).
- Add a visible video toggle that is a first-class setting, not only a fallback.
- Cache search results briefly and add a spinner state.
- Consider filtering embed-restricted results when YouTube exposes that flag.
- Optionally provide a command-only "lite" build for users who do not want an
  iframe.

## 9. Version history

- **0.3.0**: VISIONOS stream extraction for UMG/label-blocked videos, Blob
  `<audio>` playback, `audioSource` setting, stream-to-embed fallback, live
  resolver/byte validation.
- **0.2.0**: standalone rewrite. Removed the sidecar; added iframe playback,
  `BdApi.Net.fetch` search, oEmbed metadata, listening handshake, autoplay and
  embed-error fallbacks; one-file install.
- **0.1.1**: hotkey moved from Alt+Y to Alt+Q, Spotify-matched artwork sizing,
  inside-panel left-edge guard, startup mutual exclusion.
- **0.1.0**: initial YouTubePanel + yt-dlp/mpv sidecar.
