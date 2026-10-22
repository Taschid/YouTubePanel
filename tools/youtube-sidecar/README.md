# YouTubePanel sidecar

Local HTTP service for the `YouTubePanel` BetterDiscord plugin. It wraps
[`yt-dlp`](https://github.com/yt-dlp/yt-dlp) for search/metadata and
[`mpv`](https://mpv.io/) for audio playback, so the Discord renderer only needs
`fetch` to `127.0.0.1`.

## Requirements

- Node.js 20+ (tested with 24.19)
- `yt-dlp` on PATH (`winget install yt-dlp.yt-dlp`)
- `mpv` (`winget install shinchiro.mpv`; the sidecar also checks
  `C:\Program Files\MPV Player\mpv.exe` when PATH is stale)

## Start

```bat
start-youtube-panel.cmd
```

The launcher creates `config.json` from `config.example.json` on first run. The
panel defaults to:

- URL: `http://127.0.0.1:8910`
- Token header: `X-Panel-Token: youtube-panel`

If you change the token in `config.json`, paste the same token in the panel's
Settings screen.

## Config

| Key | Default | Meaning |
| --- | --- | --- |
| `port` | `8910` | loopback HTTP port |
| `token` | `youtube-panel` | required `X-Panel-Token` value |
| `mpvPath` | `mpv` | executable or absolute path; auto-detects the winget install |
| `ytdlpPath` | `yt-dlp` | executable or absolute path |
| `volume` | `70` | initial mpv volume |
| `searchLimit` | `15` | search results per query |

Command-line overrides: `--port`, `--token`, `--mpv`, `--ytdlp`.

## API

All routes require the token except `OPTIONS` preflight.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/health` | mpv/yt-dlp status |
| GET | `/state` | current track, position, duration, queue, repeat/shuffle |
| GET | `/search?q=` | YouTube search via `ytsearch` |
| GET | `/queue` | queue snapshot |
| POST | `/play` | `{ url }` or `{ query }`; resolves, queues and plays |
| POST | `/playlist` | `{ url }`; flat playlist -> queue -> play first |
| POST | `/queue/add` | `{ url }` or `{ query }`; add one or a playlist |
| POST | `/queue/remove` | `{ index }` |
| POST | `/jump` | `{ index }`; play a queue item |
| POST | `/pause`, `/resume` | transport |
| POST | `/next`, `/previous` | queue transport |
| POST | `/seek` | `{ seconds }` |
| POST | `/volume` | `{ percent }` |
| POST | `/shuffle` | shuffle upcoming |
| POST | `/repeat` | `{ state: "off" \| "all" \| "one" }`, or cycle with `{}` |
| POST | `/stop` | stop audio and clear queue |
| POST | `/clear` | stop audio and clear queue |

## Notes

- The service binds to `127.0.0.1` only. Do not expose it to the LAN.
- `yt-dlp` resolves a direct audio URL for each track; mpv plays it with
  `--no-video --no-config`.
- YouTube metadata often omits `track`/`artist`; the sidecar parses
  `Artist - Title` and strips common `(Official Video)` noise.
- Private/age-restricted content and YT Music library access need cookies; that
  is deliberately deferred (v1 is public search and public playlists).
- yt-dlp breaks when YouTube changes; update it with `yt-dlp -U` or winget.
