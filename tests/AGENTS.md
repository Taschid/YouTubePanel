# Agent guide: YouTubePanel tests

This folder is the whole test surface for the plugin. Everything here runs in
plain Node with no Discord, no BetterDiscord and no network unless explicitly
asked. Read this before changing the plugin or the tests.

## TL;DR

```bat
node tests/run-all.js            :: offline suite, must always pass
node tests/run-all.js --live     :: offline + real YouTube network checks
node tests/run-all.js --help     :: list suites, requirements, exit codes
```

Exit codes: `0` all ran and passed, `1` at least one assertion failed, `2` bad
arguments. Do not scrape the text; use the exit code.

## Suites

| File | Network | Covers |
| --- | --- | --- |
| `YouTubePanel.lifecycle-test.js` | no | `cleanTitle` / `normalizeTrack` / `normalizeSearch` / `Queue`, plugin start/stop, settings panel, settings persistence, hotkey registration, Discord bot bridge (`sendMusicCommand`, `sendRawMusicCommand`), panel coexistence via `window.__jcodePanels` |
| `YouTubePanel.live-search-test.js` | yes + sidecar | sidecar `/health`, real `/search` (yt-dlp), and `/selftest?mode=network` (stream resolve + mpv advance). SKIPs when nothing is listening on the configured port |
| `run-all.js` | - | runner; prints `PASS`/`FAIL` per suite, then `SUMMARY suites=N failed=M` |

Individual suites are also runnable directly:

```bat
node tests/YouTubePanel.lifecycle-test.js
node tests/YouTubePanel.live-search-test.js
```

## How the harness works

The lifecycle suite is a single-file script that:

1. Build a fake `BdApi` (and `BdApi.React`) and install it as a global.
2. Install `global.window` and `global.document` stubs.
3. `require("../YouTubePanel.plugin.js")` (or the sidecar helpers) and drive the
   exported methods directly.
4. Print one `PASS <label>` or `FAIL <label>` line per assertion and set
   `process.exitCode = 1` on any failure.

The live suite does not touch the plugin; it talks HTTP to the sidecar on
`127.0.0.1:<port>` using the token from `tools/youtube-sidecar/config.json` (or
`YOUTUBE_PANEL_PORT` / `YOUTUBE_PANEL_TOKEN`).

The fake React is deliberately tiny: `createElement`, `useState`, `useEffect`,
`useReducer`, `useRef` and a bare `Component` class. There is no reconciler, so
tests must not depend on rendered DOM. Assert on returned data, calls made to
the mocks, and saved settings instead.

`BdApi.Data.load()` returns a mutable `settings` object per test file, so state
leaks between assertions inside a file. Reset fields explicitly (the existing
tests already restore values such as `settings.musicChannelId`).

## Adding a test

- Put the assertion in the matching suite. A new subsystem gets a new
  `tests/<name>-test.js` file and one entry in the `suites` array of
  `run-all.js` (`offline: true` unless it really needs the network).
- Use the local `assert(cond, label)` / `check(cond, label)` helper so the
  output stays one line per assertion.
- Keep it deterministic. No timers, no real sockets, no real `fetch` in the
  offline suite; stub `BdApi.Net.fetch` instead.
- Failures must set `process.exitCode = 1`; never `process.exit()` mid-suite.
- Verify with `node tests/run-all.js` before committing.

## Contracts that must not change casually

- `window.__jcodePanels` is the cross-panel registry shared with SpotifyPanel and
  SideChat. The key `youtube` and the `{ hide }` shape are part of that contract;
  renaming them breaks sibling plugins.
- The plugin file must stay `YouTubePanel.plugin.js` at the repo root - the
  tests require it by that relative path.
- `YouTubePanel._internals` is the test seam used by the live suite. If a symbol
  moves, update `_internals` and the test together.

## Pitfalls

- Node 20+ is required (`node --version`). No dependencies, no `npm install`.
- The live suite needs the sidecar running and network access. Without a
  listener it prints `SKIP` and exits 0, so a green `--live` run does not prove
  the network path was exercised - read the suite output. When it does run, a
  failure can be a network outage, a captcha, or a YouTube format change;
  confirm manually before assuming the plugin is broken. The offline suite is
  the gate.
- Windows paths: the plugin resolves `require`-relative paths, so run the tests
  from the repo root or let `run-all.js` set `cwd` for you.
- `.jcode-tests` no longer exists; older notes and commits refer to it. It is
  `tests/` now.
