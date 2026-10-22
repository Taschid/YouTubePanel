# YouTubePanel standalone spec

Status: v0.2.0 (2026-10-22)
Scope: one-file BetterDiscord plugin; no sidecar, mpv, yt-dlp, Node server, or
localhost process.

## 1. Decision

Playback uses YouTube's standard embedded player in a hidden iframe. Search and
metadata use YouTube's public pages through `BdApi.Net.fetch`.

This is the only route that keeps the plugin to one `.plugin.js` file while
still playing arbitrary YouTube links. The alternative, extracting audio
streams, needs yt-dlp and therefore an external process.

## 2. Evidence

- Discord stable and PTB send `frame-src` containing
  `https://www.youtube.com/embed/` and `https://www.youtube.com/s/player/`.
- Discord `img-src` contains `https://i.ytimg.com` and `https://*.youtube.com`,
  so thumbnails render.
- `BdApi.Net.fetch` is an official BetterDiscord API that performs requests
  outside the renderer's CORS `connect-src` restrictions.
- A live fetch of `https://www.youtube.com/results?search_query=...` returned
  `ytInitialData` with 22 `videoRenderer` entries.
- A headless Chrome test at 2x2 emitted `initialDelivery`, `onReady`,
  `infoDelivery`, and `apiInfoDelivery` after the listening handshake, with
  `isPlayable:true` and a real duration.

## 3. iframe protocol

Iframe URL:

```
https://www.youtube.com/embed/<id>?autoplay=1&enablejsapi=1&playsinline=1&rel=0&hl=en&origin=<origin>&widget_referrer=<href>
```

Handshake, once per iframe load and then every 250ms until the player replies:

```js
{ event: "listening", id: playerId, channel: "widget" }
```

Commands:

```js
{ event: "command", func: "playVideo", args: [], id: playerId, channel: "widget" }
{ event: "command", func: "pauseVideo", args: [], id: playerId, channel: "widget" }
{ event: "command", func: "stopVideo", args: [], id: playerId, channel: "widget" }
{ event: "command", func: "seekTo", args: [seconds, true], id: playerId, channel: "widget" }
{ event: "command", func: "setVolume", args: [0-100], id: playerId, channel: "widget" }
```

Events consumed:

- `initialDelivery`: full player info, including `duration`, `playerState`,
  `videoData.isPlayable`.
- `infoDelivery`: current time, duration, state, volume.
- `onReady`: player API ready.
- `alreadyInitialized`: player accepted the handshake but may not resend initial
  info.
- `onError`: `101`/`150` mean embedding is not allowed for that video.

Player states: `-1` unstarted, `0` ended, `1` playing, `2` paused, `3` buffering,
`5` cued.

## 4. Engine state

```js
{
  track, isPlaying, position, duration, volume,
  shuffle, repeat, blocked, videoVisible, error,
  queue: { items, index, upcoming }
}
```

- `blocked` becomes true when no `initialDelivery`/`infoDelivery` arrives within
  4.5s. The UI can expand the iframe with Show video.
- Playback starts with `mute=1` for autoplay; `unMute` + `setVolume` follow the
  first delivery. Chrome blocks automatic unmute, so a still-muted player after
  2s sets `blocked` and the UI shows Enable sound. That button sends `unMute`
  inside a real click; if it still fails, the iframe expands to 320x180.
- `error` is set for `onError` and unplayable video data.
- `videoVisible` controls whether the 2x2 host expands to 320x180.

## 5. Host placement and cleanup

- Host is appended to `document.body`, outside the panel.
- Default: 2x2, opacity `0.01`, pointer-events none, bottom-left.
- Visible fallback: 320x180, bottom-right, z-index 9999, pointer-events auto.
- `destroy()` removes the iframe, host, message listener, load timer, and
  listening timer.
- `ensureHost()` removes stale `#youtubepanel-audio-host` nodes from earlier
  reloads.

## 6. Search and metadata

- Search URL: `https://www.youtube.com/results?search_query=<q>&hl=en&gl=US`.
- Extract `ytInitialData` with a balanced-brace scanner, then recursively collect
  `videoRenderer`.
- Normalize to `{ id, title, artist, duration, thumbnail, url }`.
- De-duplicate by id, cap at 20.
- oEmbed: `https://www.youtube.com/oembed?url=<watch-url>&format=json`.
- If search fails (consent, captcha, HTML change), keep URL playback working and
  show a useful error.

## 7. Limitations and fallbacks

| Failure | Behavior |
| --- | --- |
| Search page changes | Error: paste a URL instead |
| Consent/captcha | Error: paste a URL instead |
| Autoplay blocked | Show video expands the iframe; user clicks YouTube play |
| Embedding disabled (101/150) | Error plus Open on YouTube |
| Age/private/unavailable | YouTube error plus Open on YouTube |
| Ads | Play through YouTube; no skip |
| Panel hidden | Iframe stays on body; audio intended to continue |
| YouTube HTML/API change | URL playback may still work; search may break |

## 8. Validation checklist

- `node --check YouTubePanel.plugin.js`
- `.jcode-tests/YouTubePanel.lifecycle-test.js` (80 assertions)
- `.jcode-tests/YouTubePanel.live-search-test.js` (network)
- Headless Chrome: listening handshake, `initialDelivery`, `infoDelivery`,
  `onReady`, 2x2 host, embed error 150.
- Live Discord: search, play, pause, seek, volume, next, hide/show, bot send.
- Confirm no `mpv`/sidecar process and no `8910` listener.
