# YouTubePanel standalone spec

Status: v0.3.0 (2026-10-22)
Scope: one-file BetterDiscord plugin; no sidecar, mpv, yt-dlp, Node server, or
localhost process.

## 1. Decision

Default playback resolves audio through YouTube's `VISIONOS` Innertube client,
fetches the bytes through `BdApi.Net.fetch`, and plays them as a Blob through a
hidden `<audio>` element. The standard embed iframe is the fallback.

This keeps the plugin to one `.plugin.js` while playing UMG/label-blocked
videos. It is not the official embed path and is not ToS-clean.

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
- A live VISIONOS player request for the UMG-blocked `K0HSD_i2DvA` returned
  `playabilityStatus: OK` and an AAC `itag 140` URL (`contentLength` 3.9 MB).
- A ranged `BdApi.Net.fetch` request for that URL returned non-empty bytes.

## 3. Stream extraction

```
GET  youtube.com/watch?v=<id>&hl=en        -> visitorData
POST youtube.com/youtubei/v1/player         -> streamingData.adaptiveFormats
GET  <googlevideo audio url>                -> audio bytes
Blob -> <audio src=blob:...>                -> playback
```

Client context:

```js
{
  clientName: "VISIONOS",
  clientVersion: "1.02",
  deviceMake: "Apple",
  deviceModel: "RealityDevice17,1",
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) ...",
  osName: "visionOS",
  osVersion: "26.5.23O471",
  hl: "en", gl: "US",
  visitorData
}
```

Headers: `X-Goog-Visitor-Id`, `X-Goog-Api-Format-Version: 2`, Safari
User-Agent. Audio preference: itag 140 (AAC 128k), then 251 (Opus), 139
(AAC 48k).

The VISIONOS client is not an embed client, so the publisher's
`playableInEmbed` flag is not applied. This is why UMG-blocked videos resolve.

## 4. iframe fallback protocol

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

## 5. Engine state

```js
{
  track, isPlaying, position, duration, volume,
  shuffle, repeat, blocked, videoVisible, error,
  mode, loading, streamError,
  queue: { items, index, upcoming }
}
```

- `mode`: `none`, `loading`, `stream`, or `embed`.
- `loading`: stream resolve/fetch in progress.
- `streamError`: last extraction failure; the engine then calls `loadEmbed`.
- `blocked` becomes true when no `initialDelivery`/`infoDelivery` arrives within
  4.5s. The UI can expand the iframe with Show video.
- Playback starts with `mute=1` for autoplay; `unMute` + `setVolume` follow the
  first delivery. Chrome blocks automatic unmute, so a still-muted player after
  2s sets `blocked` and the UI shows Enable sound. That button sends `unMute`
  inside a real click; if it still fails, the iframe expands to 320x180.
- `error` is set for `onError` and unplayable video data.
- `videoVisible` controls whether the 2x2 host expands to 320x180.

## 6. Host placement and cleanup

- Stream mode uses a hidden `<audio>` element on `document.body`.
- Embed fallback uses a host appended to `document.body`, outside the panel.
- Default: 2x2, opacity `0.01`, pointer-events none, bottom-left.
- Visible fallback: 320x180, bottom-right, z-index 9999, pointer-events auto.
- `destroy()` removes `<audio>`, the iframe, host, message listener, timers, and
  revokes the Blob URL.
- `ensureHost()` removes stale `#youtubepanel-audio-host` nodes from earlier
  reloads.

## 7. Search and metadata

- Search URL: `https://www.youtube.com/results?search_query=<q>&hl=en&gl=US`.
- Extract `ytInitialData` with a balanced-brace scanner, then recursively collect
  `videoRenderer`.
- Normalize to `{ id, title, artist, duration, thumbnail, url }`.
- De-duplicate by id, cap at 20.
- oEmbed: `https://www.youtube.com/oembed?url=<watch-url>&format=json`.
- If search fails (consent, captcha, HTML change), keep URL playback working and
  show a useful error.

## 8. Limitations and fallbacks

| Failure | Behavior |
| --- | --- |
| Search page changes | Error: paste a URL instead |
| Consent/captcha | Error: paste a URL instead |
| Autoplay blocked | Show video expands the iframe; user clicks YouTube play |
| UMG/embed block | Stream extraction plays it; embed fallback shows error |
| Stream resolver fails | Embed iframe, then Send to bot / Open on YouTube |
| Age/private/unavailable | YouTube error plus Open on YouTube |
| Ads | Stream path bypasses ads (ToS risk); embed may show ads |
| Panel hidden | `<audio>` or iframe stays on body; audio continues |
| YouTube HTML/API change | URL playback may still work; search may break |

## 9. Validation checklist

- `node --check YouTubePanel.plugin.js`
- `.jcode-tests/YouTubePanel.lifecycle-test.js` (102 assertions)
- `.jcode-tests/YouTubePanel.live-search-test.js` (network)
- Live resolver: VISIONOS `OK`, itag 140 URL, ranged byte fetch.
- Headless Chrome: listening handshake, `initialDelivery`, `infoDelivery`,
  `onReady`, 2x2 host, embed error 150.
- Live Discord: search, play, pause, seek, volume, next, hide/show, bot send.
- Confirm no `mpv`/sidecar process and no `8910` listener.
