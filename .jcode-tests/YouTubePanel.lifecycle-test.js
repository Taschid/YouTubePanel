"use strict";

// Headless lifecycle test for YouTubePanel and its sidecar helpers.
// Run: node .jcode-tests/YouTubePanel.lifecycle-test.js

const assert = (cond, label) => {
  console.log((cond ? "PASS " : "FAIL ") + label);
  if (!cond) process.exitCode = 1;
};

const saved = [];
const styles = [];
let settings = {
  sidecarUrl: "http://127.0.0.1:8910",
  sidecarToken: "youtube-panel",
  musicChannelId: "123456789",
  musicBotId: "jockie",
  musicBotPrefix: "",
  musicBotCommands: {},
  width: 420,
  height: 330,
  fullHeight: true,
  visible: true,
  hotkey: ["Alt", "y"],
  topOffset: 12,
  volume: 70,
};

const ReactFake = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (v) => [typeof v === "function" ? v() : v, () => {}],
  useEffect: () => {},
  useReducer: (r, i) => [i, () => {}],
  useRef: (v) => ({ current: v }),
  Component: class { constructor(props) { this.props = props; this.state = {}; } },
};

const BdApi = function BdApiCtor() {
  return {
    Data: {
      load: () => settings,
      save: (key, value) => saved.push([key, value]),
    },
    Logger: { info: () => {} },
    DOM: {
      addStyle: (id) => styles.push(id),
      removeStyle: (id) => styles.push("removed:" + id),
    },
    UI: { buildSettingsPanel: (o) => o },
    React: ReactFake,
    ReactDOM: { createRoot: () => ({ render: () => {}, unmount: () => {} }) },
    Webpack: { getByKeys: () => null, getByProps: () => null, getModule: () => null },
  };
};
BdApi.React = ReactFake;
global.BdApi = BdApi;
global.window = {};
global.document = { querySelectorAll: () => [] };

const { cleanTitle, normalizeTrack, normalizeSearch, Queue } = require("../tools/youtube-sidecar/lib.js");
const YouTubePanel = require("../YouTubePanel.plugin.js");

const track = normalizeTrack({
  id: "abc123",
  title: "Daft Punk - Around The World (Official Music Video Remastered)",
  uploader: "Daft Punk",
  duration: 242,
  thumbnail: "https://i.ytimg.com/vi/abc123/mqdefault.jpg",
});
const statePayload = {
  ok: true,
  track,
  position: 12.5,
  duration: 242,
  isPlaying: true,
  isPaused: false,
  volume: 70,
  repeat: "off",
  shuffle: false,
  queue: { items: [track], index: 0, current: track, upcoming: [], repeat: "off", shuffle: false },
  mpv: true,
  mpvError: "",
  ytdlp: "test",
};

const calls = [];
const json = (body, status) => ({
  ok: (status || 200) < 400,
  status: status || 200,
  json: async () => body,
});
const baseFetch = async (url, options = {}) => {
  calls.push({
    url: String(url),
    method: options.method || "GET",
    headers: options.headers || {},
    body: options.body,
  });
  const u = new URL(String(url));
  if (u.pathname === "/health") return json({ ok: true, mpv: true, ytdlp: "test", mpvError: "" });
  if (u.pathname === "/state") return json(statePayload);
  if (u.pathname === "/search") return json({ items: [track] });
  if (u.pathname === "/play") return json({ ok: true, track, state: statePayload });
  if (u.pathname === "/queue/add") return json({ ok: true, tracks: [track], queue: statePayload.queue });
  if (u.pathname === "/jump") return json({ ok: true, track, state: statePayload });
  if (u.pathname === "/repeat") return json({ ok: true, repeat: "one" });
  return json({ ok: true });
};
global.fetch = baseFetch;

(async () => {
  // ------------------------------------------------------------- sidecar lib
  assert(cleanTitle("Song [Official Audio]") === "Song", "cleanTitle removes audio noise");
  assert(track.title === "Around The World", "normalizeTrack splits artist - title");
  assert(track.artist === "Daft Punk", "normalizeTrack keeps uploader artist");
  assert(track.url === "https://www.youtube.com/watch?v=abc123", "normalizeTrack builds watch URL");
  assert(track.thumbnail.includes("abc123"), "normalizeTrack builds thumbnail");

  const hyphen = normalizeTrack({ id: "h1", title: "Song - Part 2", uploader: "Artist" });
  assert(hyphen.title === "Song - Part 2" && hyphen.artist === "Artist", "hyphenated titles do not fake an artist");

  const searchPayload = normalizeSearch({
    entries: [
      { id: "a", title: "Artist A - Track A", uploader: "Artist A", duration: 10 },
      null,
      { id: "b", title: "Track B", uploader: "Artist B", duration: 20 },
    ],
  });
  assert(searchPayload.length === 2 && searchPayload[1].id === "b", "search payload drops empty entries");

  const q = new Queue();
  q.set([{ id: "a" }, { id: "b" }, { id: "c" }], 1);
  assert(q.current().id === "b", "queue starts at offset");
  assert(q.next(false).id === "c", "queue next advances");
  assert(q.next(false) === null, "queue stops at the end");
  assert(q.previous().id === "b", "queue previous moves back");
  q.repeat = "all";
  q.index = 2;
  assert(q.next(true).id === "a", "repeat all wraps");
  q.repeat = "one";
  q.index = 1;
  assert(q.next(true).id === "b", "repeat one keeps the current track");
  const removed = q.remove(1);
  assert(removed.id === "b" && q.items.length === 2, "queue remove drops a track");
  q.set([{ id: "a" }, { id: "b" }, { id: "c" }], 0);
  const beforeShuffle = q.items.map((t) => t.id).join("");
  q.shuffleUpcoming();
  assert(q.items.length === 3 && q.items[0].id === "a", "shuffle keeps the current track first");
  assert(q.items.map((t) => t.id).join("") !== "" && beforeShuffle.length === 3, "shuffle keeps all tracks");

  // ---------------------------------------------------------- sidecar client
  const sp = new YouTubePanel({ name: "YouTubePanel" });
  assert(sp.settings.sidecarUrl === "http://127.0.0.1:8910", "default sidecar URL");
  assert(sp.settings.hotkey.join("+").toLowerCase() === "alt+q", "legacy Alt+Y migrates to Alt+Q");
  {
    const withHotkey = settings;
    settings = { ...settings };
    delete settings.hotkey;
    const fresh = new YouTubePanel({});
    assert(fresh.settings.hotkey.join("+").toLowerCase() === "alt+q", "default hotkey is Alt+Q");
    settings = withHotkey;
  }

  const health = await sp.health();
  assert(health.mpv === true && health.ytdlp === "test", "health response parsed");
  const search = await sp.search("daft punk");
  assert(search.items.length === 1 && search.items[0].title === "Around The World", "search response parsed");
  const searchCall = calls.find((c) => c.url.includes("/search?q="));
  assert(searchCall && searchCall.url.includes("daft%20punk"), "search query is encoded");
  assert(searchCall.headers["X-Panel-Token"] === "youtube-panel", "token header is sent");

  await sp.play({ url: track.url });
  const playCall = calls.find((c) => c.url.endsWith("/play"));
  assert(playCall.method === "POST" && JSON.parse(playCall.body).url === track.url, "play sends URL body");
  await sp.pause();
  assert(calls.some((c) => c.url.endsWith("/pause") && c.method === "POST"), "pause maps to POST");
  await sp.seek(42.5);
  const seekCall = calls.find((c) => c.url.endsWith("/seek"));
  assert(JSON.parse(seekCall.body).seconds === 42.5, "seek sends seconds");
  await sp.setVolume(55.4);
  const volCall = calls.find((c) => c.url.endsWith("/volume"));
  assert(JSON.parse(volCall.body).percent === 55.4, "volume sends percent");
  await sp.repeat("one");
  const repeatCall = calls.find((c) => c.url.endsWith("/repeat"));
  assert(JSON.parse(repeatCall.body).state === "one", "repeat sends state");
  await sp.jump(2);
  const jumpCall = calls.find((c) => c.url.endsWith("/jump"));
  assert(JSON.parse(jumpCall.body).index === 2, "jump sends index");

  // offline sidecar surfaces a useful error
  const goodFetch = global.fetch;
  global.fetch = async () => { throw new Error("Failed to fetch"); };
  let offline = null;
  try { await sp.state(); } catch (e) { offline = e; }
  assert(offline && /sidecar offline/.test(offline.message), "offline sidecar has a clear error");
  global.fetch = goodFetch;

  // 448 gets an actionable path message instead of a bare Windows code
  global.fetch = async () => json({ error: "The path cannot be traversed because it contains an untrusted mount point (448)." }, 500);
  let blocked = null;
  try { await sp.play({ url: track.url }); } catch (e) { blocked = e; }
  assert(blocked && /Windows error 448/.test(blocked.message), "448 is explained");
  assert(blocked && /%PUBLIC%/.test(blocked.message), "448 points at a safe local folder");
  global.fetch = goodFetch;

  // ---------------------------------------------------------- bot commands
  sp.settings.musicChannelId = "123456789";
  sp.settings.musicBotId = "jockie";
  assert(sp.formatMusicCommand("play", track) === "m!play " + track.url, "default play uses the YouTube URL");
  assert(sp.formatMusicCommand("skip", track) === "m!skip", "Jockie skip maps");
  sp.settings.musicBotPrefix = "@Bot ";
  assert(sp.formatMusicCommand("play", track) === "@Bot play " + track.url, "prefix override applies");
  sp.settings.musicBotPrefix = "";
  sp.settings.musicBotCommands = { play: "{prefix}play {query}" };
  assert(sp.formatMusicCommand("play", track) === "m!play Around The World Daft Punk", "query override uses title and artist");
  sp.settings.musicBotCommands = {};

  const sent = [];
  BdApi.Webpack = {
    getByKeys: () => ({ sendMessage: (channelId, message) => { sent.push({ channelId, message }); return Promise.resolve({}); } }),
    getByProps: () => null,
    getModule: () => null,
  };
  const playRes = await sp.sendMusicCommand("play", track);
  assert(playRes.ok && sent[0].channelId === "123456789", "bot play targets the channel");
  assert(sent[0].message.content === "m!play " + track.url, "bot play content uses URL");
  const rawRes = await sp.sendRawMusicCommand("m!volume 20");
  assert(rawRes.ok && sent[1].message.content === "m!volume 20", "raw bot command sends unchanged");

  sp.settings.musicChannelId = "";
  const noChannel = await sp.sendMusicCommand("play", track);
  assert(!noChannel.ok && /music channel id/.test(noChannel.error), "missing channel is reported");
  sp.settings.musicChannelId = "123456789";
  const noTrack = await sp.sendMusicCommand("play", null);
  assert(!noTrack.ok && /nothing playing/.test(noTrack.error), "missing track is reported");
  sp.settings.musicBotCommands = { play: "" };
  const hiddenPlay = await sp.sendMusicCommand("play", track);
  assert(!hiddenPlay.ok && /no play command/.test(hiddenPlay.error), "disabled play template is reported");
  sp.settings.musicBotCommands = {};

  const panel = sp.getSettingsPanel();
  const field = (id) => panel.settings.find((s) => s.id === id);
  assert(field("sidecarUrl").value === "http://127.0.0.1:8910", "BD settings has sidecar URL");
  assert(field("sidecarToken").value === "youtube-panel", "BD settings has token");
  assert(field("musicBotId").type === "dropdown" && field("musicBotId").options.length === 4, "BD settings has bot dropdown");
  assert(field("musicBotCommands") && field("hotkey"), "BD settings has overrides and hotkey");
  panel.onChange("", "musicBotId", "jmusicbot");
  assert(sp.settings.musicBotId === "jmusicbot" && Object.keys(sp.settings.musicBotCommands).length === 0, "bot change resets overrides");
  assert(saved.some(([key, value]) => key === "settings" && value.musicBotId === "jmusicbot"), "bot change is saved");
  sp.settings.musicBotId = "jockie";

  // ------------------------------------------------------------ coexistence
  let hidden = 0;
  global.window.__jcodePanels = { spotify: { hide: () => { hidden += 1; } } };
  sp.registerPanel();
  assert(!!global.window.__jcodePanels.youtube, "registers youtube panel");
  sp.settings.visible = false;
  sp.togglePanel();
  assert(hidden === 1 && sp.settings.visible === true, "showing YouTube hides Spotify");
  sp.hidePanel();
  assert(sp.settings.visible === false, "hidePanel hides without toggling back");
  sp.unregisterPanel();
  assert(!global.window.__jcodePanels.youtube, "unregister removes youtube");

  console.log("done");
})();
