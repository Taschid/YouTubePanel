"use strict";

// Headless lifecycle test for the standalone YouTubePanel.
// Run: node .jcode-tests/YouTubePanel.lifecycle-test.js

const assert = (cond, label) => {
  console.log((cond ? "PASS " : "FAIL ") + label);
  if (!cond) process.exitCode = 1;
};

const wait = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

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

const listeners = {};
const domElements = [];
const posted = [];
const iframeWindow = {
  postMessage: (raw) => {
    try { posted.push(JSON.parse(raw)); } catch {}
  },
};

function makeElement(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    style: {},
    children: [],
    attrs: {},
    isConnected: true,
    paused: true,
    ended: false,
    currentTime: 0,
    duration: NaN,
    volume: 1,
    muted: false,
    preload: "",
    src: "",
    contentWindow: String(tag).toLowerCase() === "iframe" ? iframeWindow : undefined,
    _events: listeners,
    appendChild(child) { this.children.push(child); return child; },
    remove() { this.isConnected = false; },
    setAttribute(key, value) { this.attrs[key] = value; },
    removeAttribute(key) { delete this.attrs[key]; if (key === "src") this.src = ""; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    emit(type) { for (const fn of listeners[type] || []) fn({ type, target: this }); },
    play() { this.paused = false; this.ended = false; this.emit("play"); return Promise.resolve(); },
    pause() { this.paused = true; this.emit("pause"); },
    load() {},
  };
  domElements.push(el);
  return el;
}

if (!global.URL) global.URL = require("url").URL;
global.URL.createObjectURL = () => "blob:youtubepanel-test";
global.URL.revokeObjectURL = () => {};

global.document = {
  body: {
    appendChild(el) { el.isConnected = true; return el; },
    contains(el) { return !!el && el.isConnected; },
    removeChild() {},
  },
  createElement: makeElement,
  querySelectorAll: () => [],
  addEventListener(type, fn) { listeners[type] = fn; },
  removeEventListener(type, fn) { if (listeners[type] === fn) delete listeners[type]; },
};
global.window = {
  addEventListener(type, fn) { listeners[type] = fn; },
  removeEventListener(type, fn) { if (listeners[type] === fn) delete listeners[type]; },
  innerWidth: 1280,
  innerHeight: 800,
  __jcodePanels: {},
};
global.location = {
  origin: "https://ptb.discord.com",
  href: "https://ptb.discord.com/channels/1/2",
};

const searchHtml = "<!doctype html><script>var ytInitialData = " + JSON.stringify({
  contents: {
    twoColumnSearchResultsRenderer: {
      primaryContents: {
        sectionListRenderer: {
          contents: [{
            itemSectionRenderer: {
              contents: [
                {
                  videoRenderer: {
                    videoId: "K0HSD_i2DvA",
                    title: { runs: [{ text: "Daft Punk - Around The World" }] },
                    ownerText: { runs: [{ text: "Daft Punk" }] },
                    lengthText: { simpleText: "4:02" },
                    thumbnail: { thumbnails: [{ url: "https://i.ytimg.com/vi/K0HSD_i2DvA/hqdefault.jpg" }] },
                  },
                },
                {
                  videoRenderer: {
                    videoId: "dwDns8x3Jb4",
                    title: { simpleText: "Around the World (Official Audio)" },
                    ownerText: { runs: [{ text: "Daft Punk - Topic" }] },
                    lengthText: { simpleText: "7:10" },
                    thumbnail: { thumbnails: [{ url: "https://i.ytimg.com/vi/dwDns8x3Jb4/hqdefault.jpg" }] },
                  },
                },
              ],
            },
          }],
        },
      },
    },
  },
}) + ";</script>";

const netCalls = [];
const netRequests = [];
let failPlayer = false;
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
BdApi.Net = {
  fetch: async (url, init = {}) => {
    const value = String(url);
    netCalls.push(value);
    netRequests.push({ url: value, init });
    if (value.includes("/watch?")) {
      return {
        ok: true,
        status: 200,
        text: async () => "<script>var ytcfg={\"visitorData\":\"test-visitor\"};</script>",
      };
    }
    if (value.includes("/youtubei/v1/player")) {
      if (failPlayer) return { ok: false, status: 500, text: async () => "player failed" };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          playabilityStatus: { status: "OK" },
          streamingData: {
            adaptiveFormats: [
              { itag: 140, mimeType: "audio/mp4; codecs=\"mp4a.40.2\"", url: "https://rr.example.googlevideo.com/videoplayback?x=1", contentLength: "3" },
            ],
          },
        }),
      };
    }
    if (value.includes("googlevideo.com")) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      };
    }
    if (value.includes("/results?")) {
      return { ok: true, status: 200, text: async () => searchHtml };
    }
    if (value.includes("/oembed?")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          title: "Daft Punk - Around The World (Official Video)",
          author_name: "Daft Punk",
          thumbnail_url: "https://i.ytimg.com/vi/K0HSD_i2DvA/hqdefault.jpg",
        }),
      };
    }
    return { ok: false, status: 404, text: async () => "" };
  },
};
global.BdApi = BdApi;

const YouTubePanel = require("../YouTubePanel.plugin.js");
const {
  videoIdFromUrl,
  parseYouTubeDuration,
  extractYouTubeInitialData,
  parseYouTubeSearchData,
  LocalQueue,
} = YouTubePanel._internals;

(async () => {
  // ------------------------------------------------------------ url parsing
  assert(videoIdFromUrl("https://www.youtube.com/watch?v=K0HSD_i2DvA") === "K0HSD_i2DvA", "watch URL parses");
  assert(videoIdFromUrl("https://youtu.be/K0HSD_i2DvA?t=30") === "K0HSD_i2DvA", "youtu.be URL parses");
  assert(videoIdFromUrl("https://music.youtube.com/watch?v=dwDns8x3Jb4&list=x") === "dwDns8x3Jb4", "YouTube Music URL parses");
  assert(videoIdFromUrl("https://www.youtube.com/shorts/K0HSD_i2DvA") === "K0HSD_i2DvA", "Shorts URL parses");
  assert(videoIdFromUrl("K0HSD_i2DvA") === "K0HSD_i2DvA", "raw id parses");
  assert(videoIdFromUrl("https://example.com/video") === "", "non-YouTube URL is rejected");

  // --------------------------------------------------------------- duration
  assert(parseYouTubeDuration("4:02") === 242, "mm:ss duration parses");
  assert(parseYouTubeDuration("1:02:03") === 3723, "h:mm:ss duration parses");
  assert(parseYouTubeDuration("") === 0, "empty duration is zero");

  // ---------------------------------------------------------------- parsing
  const initial = extractYouTubeInitialData(searchHtml);
  assert(!!initial, "ytInitialData is extracted");
  const parsed = parseYouTubeSearchData(initial);
  assert(parsed.length === 2, "search parser finds two videos");
  assert(parsed[0].id === "K0HSD_i2DvA" && parsed[0].title === "Daft Punk - Around The World", "first title parses");
  assert(parsed[0].artist === "Daft Punk" && parsed[0].duration === 242, "first artist and duration parse");
  assert(parsed[1].artist === "Daft Punk", "Topic suffix is stripped");
  assert(parsed[0].thumbnail.includes("K0HSD_i2DvA"), "thumbnail is built");
  assert(parsed[0].url === "https://www.youtube.com/watch?v=K0HSD_i2DvA", "canonical URL is built");

  // --------------------------------------------------------------- queue
  const q = new LocalQueue();
  q.replace(parsed[0]);
  q.add(parsed[1]);
  assert(q.items.length === 2 && q.current().id === parsed[0].id, "queue starts at first item");
  assert(q.next(false).id === parsed[1].id, "queue next advances");
  assert(q.previous().id === parsed[0].id, "queue previous moves back");
  q.repeat = "all";
  q.index = 1;
  assert(q.next(true).id === parsed[0].id, "repeat all wraps");
  q.repeat = "one";
  assert(q.next(true).id === parsed[0].id, "repeat one keeps current");
  q.repeat = "off";
  q.shuffleUpcoming();
  assert(q.items[0].id === parsed[0].id && q.shuffle === true, "shuffle keeps current first");
  q.remove(0);
  assert(q.items.length === 1 && q.index === 0, "remove adjusts the index");

  // ------------------------------------------------------------- plugin init
  const plugin = new YouTubePanel({ name: "YouTubePanel" });
  assert(plugin.settings.sidecarUrl === undefined, "sidecar URL is removed from settings");
  assert(plugin.settings.sidecarToken === undefined, "sidecar token is removed from settings");
  assert(saved.some(([, value]) => value && value.sidecarUrl === undefined), "settings migration is saved");
  assert(plugin.settings.hotkey.join("+").toLowerCase() === "alt+q", "legacy hotkey migrates to Alt+Q");
  assert(plugin.engine && typeof plugin.engine.snapshot === "function", "local engine is created");
  plugin.engine.start();
  assert(typeof listeners.message === "function", "engine start registers the message listener: " + Object.keys(listeners).join(","));

  // ------------------------------------------------------------- search/net
  const search = await plugin.search("daft punk");
  assert(search.items.length === 2, "plugin search returns parsed items");
  assert(netCalls.some((url) => url.includes("search_query=daft%20punk")), "search query is encoded");
  assert(netCalls.some((url) => url.includes("youtube.com/results")), "search uses YouTube results page");
  const resultCalls = netCalls.filter((url) => url.includes("/results?")).length;
  await plugin.search("daft punk");
  assert(netCalls.filter((url) => url.includes("/results?")).length === resultCalls, "search results are cached");

  // ---------------------------------------------------------- stream playback
  const state = await plugin.play(parsed[0]);
  assert(state.track.id === parsed[0].id && state.queue.items.length === 1, "play replaces the queue");
  await wait(50);
  assert(plugin.state().mode === "stream", "auto source selects stream extraction");
  assert(netRequests.some((req) => req.url.includes("/youtubei/v1/player")), "Innertube player is requested");
  assert(netRequests.some((req) => req.init.headers && req.init.headers["X-Goog-Visitor-Id"] === "test-visitor"), "visitorData is sent");
  const audio = domElements.find((el) => el.tagName === "AUDIO");
  assert(!!audio && audio.src === "blob:youtubepanel-test", "audio blob is attached");
  assert(plugin.state().isPlaying === true, "stream starts playing");
  audio.duration = 242;
  audio.currentTime = 12.5;
  audio.emit("timeupdate");
  await wait();
  assert(plugin.state().position === 12.5 && plugin.state().duration === 242, "audio timeupdate updates state");
  plugin.pause();
  assert(audio.paused === true, "stream pause pauses audio");
  plugin.resume();
  assert(audio.paused === false, "stream resume plays audio");
  plugin.seek(42.5);
  assert(audio.currentTime === 42.5, "stream seek changes currentTime");
  plugin.setVolume(55.4);
  assert(Math.abs(audio.volume - 0.55) < 0.01, "stream volume changes audio volume");
  plugin.repeat("one");
  assert(plugin.state().repeat === "one", "repeat state is stored");
  audio.ended = true;
  audio.currentTime = 242;
  audio.emit("ended");
  await wait();
  assert(audio.currentTime === 0 && audio.paused === false, "stream repeat-one restarts audio");
  plugin.engine.stop();
  assert(audio.paused === true, "stream stop pauses audio");

  plugin.settings.audioSource = "auto";
  failPlayer = true;
  await plugin.play(parsed[1]);
  await wait(20);
  assert(plugin.state().mode === "embed", "stream failure falls back to embed");
  assert(domElements.some((el) => el.tagName === "IFRAME" && el.src.includes("dwDns8x3Jb4")), "fallback embeds the failed track");
  assert(/HTTP 500/.test(plugin.state().streamError), "stream failure is exposed");
  failPlayer = false;
  plugin.engine.retryStream();
  await wait(40);
  assert(plugin.state().mode === "stream", "retry stream re-resolves the track");

  // ---------------------------------------------------------- embed fallback
  plugin.settings.audioSource = "embed";
  await plugin.play(parsed[0]);
  await wait(10);
  assert(plugin.state().mode === "embed", "embed source selects the iframe");
  assert(plugin.state().gotInfo === false, "gotInfo starts false");
  const iframe = domElements.find((el) => el.tagName === "IFRAME");
  assert(!!iframe, "iframe is created");
  assert(iframe.src.includes("youtube.com/embed/K0HSD_i2DvA"), "iframe embeds the video id");
  assert(iframe.src.includes("enablejsapi=1") && iframe.src.includes("autoplay=1"), "iframe enables the js api");
  assert(iframe.src.includes("mute=1"), "iframe starts muted for autoplay");
  assert(iframe.attrs.allow.includes("autoplay"), "iframe allows autoplay");
  assert(posted.some((msg) => msg.event === "listening" && msg.channel === "widget"), "iframe API handshake is sent");
  assert(typeof listeners.message === "function", "iframe message listener is registered: " + Object.keys(listeners).join(","));

  const deliver = async (info) => {
    listeners.message({
      source: iframe.contentWindow,
      origin: "https://www.youtube.com",
      data: JSON.stringify({ event: "infoDelivery", info }),
    });
    await wait();
  };

  await deliver({ playerState: 1, currentTime: 12.5, duration: 242 });
  const live = plugin.state();
  assert(live.isPlaying && live.position === 12.5 && live.duration === 242, "infoDelivery updates state");
  assert(live.gotInfo === true, "gotInfo turns true after player info");
  assert(posted.some((msg) => msg.func === "setVolume" && msg.args[0] === 55), "initial volume is pushed");
  assert(posted.some((msg) => msg.func === "unMute"), "player is unmuted after it starts");
  const beforeSound = posted.length;
  plugin.engine.enableSound();
  assert(posted.slice(beforeSound).some((msg) => msg.func === "unMute"), "Enable sound sends unMute in the click");
  await deliver({ muted: false, playerState: 1, currentTime: 12.5, duration: 242 });
  assert(plugin.state().muted === false, "mute state clears after the player confirms sound");

  plugin.pause();
  assert(posted[posted.length - 1].func === "pauseVideo", "pause maps to pauseVideo");
  assert(posted[posted.length - 1].channel === "widget", "commands use the widget channel");
  plugin.resume();
  assert(posted[posted.length - 1].func === "playVideo", "resume maps to playVideo");
  plugin.seek(42.5);
  const seekCommand = posted.find((msg) => msg.func === "seekTo" && msg.args[0] === 42.5);
  assert(!!seekCommand && plugin.state().position === 42.5, "seek maps to seekTo");
  plugin.setVolume(55.4);
  assert(posted[posted.length - 1].func === "setVolume" && posted[posted.length - 1].args[0] === 55, "volume is clamped and pushed");
  await deliver({ playerState: 0, currentTime: 242, duration: 242 });
  await wait(20);
  assert(posted.filter((msg) => msg.func === "playVideo").length >= 2, "repeat one replays at the end");

  listeners.message({
    source: iframe.contentWindow,
    origin: "https://www.youtube.com",
    data: JSON.stringify({ event: "onError", info: 150 }),
  });
  await wait();
  assert(/embedded playback/.test(plugin.state().error), "embed-restricted videos report a clear error");

  // ------------------------------------------------------- queue navigation
  plugin.repeat("off");
  await plugin.play(parsed[0]);
  await plugin.addQueue(parsed[1]);
  assert(plugin.state().queue.items.length === 2, "addQueue appends");
  plugin.next();
  assert(plugin.state().track.id === parsed[1].id, "next loads the queued track");
  plugin.engine.position = 0;
  plugin.previous();
  assert(plugin.state().track.id === parsed[0].id, "previous loads the prior track");
  plugin.removeQueue(1);
  assert(plugin.state().queue.items.length === 1, "removeQueue removes an item");
  plugin.shuffle();
  assert(plugin.state().shuffle === true, "shuffle toggles");
  plugin.engine.setVideoVisible(true);
  assert(plugin.state().videoVisible === true, "video fallback can be shown");
  plugin.clearQueue();
  assert(plugin.state().track === null && plugin.state().queue.items.length === 0, "clearQueue resets playback");

  // ---------------------------------------------------------- bot commands
  plugin.settings.musicChannelId = "123456789";
  plugin.settings.musicBotId = "jockie";
  assert(plugin.formatMusicCommand("play", parsed[0]) === "m!play " + parsed[0].url, "default play uses the YouTube URL");
  assert(plugin.formatMusicCommand("skip", parsed[0]) === "m!skip", "Jockie skip maps");
  plugin.settings.musicBotPrefix = "@Bot ";
  assert(plugin.formatMusicCommand("play", parsed[0]) === "@Bot play " + parsed[0].url, "prefix override applies");
  plugin.settings.musicBotPrefix = "";
  plugin.settings.musicBotCommands = { play: "{prefix}play {query}" };
  assert(plugin.formatMusicCommand("play", parsed[0]) === "m!play Daft Punk - Around The World Daft Punk", "query override uses title and artist");
  plugin.settings.musicBotCommands = {};

  const sent = [];
  BdApi.Webpack = {
    getByKeys: () => ({ sendMessage: (channelId, message) => { sent.push({ channelId, message }); return Promise.resolve({}); } }),
    getByProps: () => null,
    getModule: () => null,
  };
  const playRes = await plugin.sendMusicCommand("play", parsed[0]);
  assert(playRes.ok && sent[0].channelId === "123456789", "bot play targets the channel");
  assert(sent[0].message.content === "m!play " + parsed[0].url, "bot play content uses URL");
  const rawRes = await plugin.sendRawMusicCommand("m!volume 20");
  assert(rawRes.ok && sent[1].message.content === "m!volume 20", "raw bot command sends unchanged");

  plugin.settings.musicChannelId = "";
  const noChannel = await plugin.sendMusicCommand("play", parsed[0]);
  assert(!noChannel.ok && /music channel id/.test(noChannel.error), "missing channel is reported");
  plugin.settings.musicChannelId = "123456789";
  const noTrack = await plugin.sendMusicCommand("play", null);
  assert(!noTrack.ok && /nothing playing/.test(noTrack.error), "missing track is reported");
  plugin.settings.musicBotCommands = { play: "" };
  const hiddenPlay = await plugin.sendMusicCommand("play", parsed[0]);
  assert(!hiddenPlay.ok && /no play command/.test(hiddenPlay.error), "disabled play template is reported");
  plugin.settings.musicBotCommands = {};

  // ------------------------------------------------------------- settings
  const panel = plugin.getSettingsPanel();
  const field = (id) => panel.settings.find((s) => s.id === id);
  assert(!field("sidecarUrl") && !field("sidecarToken"), "settings have no sidecar fields");
  assert(field("audioSource").type === "dropdown" && field("audioSource").options.length === 3, "settings have audio source options");
  assert(field("musicBotId").type === "dropdown" && field("musicBotId").options.length === 4, "settings have the bot dropdown");
  assert(field("musicBotCommands") && field("hotkey"), "settings have overrides and hotkey");
  panel.onChange("", "musicBotId", "jmusicbot");
  assert(plugin.settings.musicBotId === "jmusicbot" && Object.keys(plugin.settings.musicBotCommands).length === 0, "bot change resets overrides");
  assert(saved.some(([key, value]) => key === "settings" && value.musicBotId === "jmusicbot"), "bot change is saved");
  plugin.settings.musicBotId = "jockie";
  panel.onChange("", "audioSource", "stream");
  assert(plugin.settings.audioSource === "stream", "audio source changes");
  panel.onChange("", "audioSource", "embed");
  assert(plugin.settings.audioSource === "embed", "audio source saves embed mode");

  // ------------------------------------------------------------ coexistence
  let hidden = 0;
  global.window.__jcodePanels = { spotify: { hide: () => { hidden += 1; } } };
  plugin.registerPanel();
  assert(!!global.window.__jcodePanels.youtube, "registers youtube panel");
  plugin.settings.visible = false;
  plugin.togglePanel();
  assert(hidden === 1 && plugin.settings.visible === true, "showing YouTube hides Spotify");
  plugin.hidePanel();
  assert(plugin.settings.visible === false, "hidePanel hides without toggling back");
  plugin.unregisterPanel();
  assert(!global.window.__jcodePanels.youtube, "unregister removes youtube");

  plugin.engine.destroy();
  console.log("done");
})();
