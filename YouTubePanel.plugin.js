/**
 * @name YouTubePanel
 * @description Docked YouTube / YouTube Music controller for Discord, driven by a local yt-dlp + mpv sidecar.
 * @version 0.5.1
 * @author jcode
 * @authorId 0
 */

const PLUGIN = "YouTubePanel";
const { React } = BdApi;
const h = React.createElement;
const { useState, useEffect, useRef, useReducer } = React;

const DEFAULT_SETTINGS = {
  sidecarUrl: "http://127.0.0.1:8910",
  sidecarToken: "youtube-panel",
  musicChannelId: "",
  musicBotId: "jockie",
  musicBotPrefix: "",
  musicBotCommands: {},
  width: 420,
  height: 330,
  fullHeight: true,
  visible: true,
  hotkey: ["Alt", "q"],
  topOffset: 12,
  volume: 70,
};

const MUSIC_BOT_ACTIONS = [
  { id: "play", label: "Play current track", icon: "play" },
  { id: "pause", label: "Pause", icon: "pause" },
  { id: "resume", label: "Resume", icon: "play" },
  { id: "skip", label: "Skip", icon: "next" },
  { id: "previous", label: "Previous", icon: "prev" },
  { id: "repeat", label: "Repeat / loop", icon: "repeat" },
  { id: "shuffle", label: "Shuffle", icon: "shuffle" },
  { id: "queue", label: "Queue", icon: "queue" },
  { id: "nowPlaying", label: "Now playing", icon: "list" },
  { id: "stop", label: "Stop / leave", icon: "close" },
];

// Same verified Discord bot profiles as SpotifyPanel, but the default play
// command uses the exact YouTube URL, which music bots resolve more reliably
// than a free-text search.
const MUSIC_BOTS = [
  {
    id: "jockie",
    label: "Jockie Music",
    prefix: "m!",
    note: "m! prefix. Play uses the YouTube URL; {query} is available for text search.",
    commands: {
      play: "{prefix}play {url}",
      pause: "{prefix}pause",
      resume: "{prefix}resume",
      skip: "{prefix}skip",
      previous: "{prefix}previous",
      repeat: "{prefix}repeat queue",
      shuffle: "{prefix}shuffle",
      queue: "{prefix}queue",
      nowPlaying: "{prefix}np",
      stop: "{prefix}stop",
    },
  },
  {
    id: "jmusicbot",
    label: "JMusicBot",
    prefix: "!",
    note: "Self-hosted. No previous command.",
    commands: {
      play: "{prefix}play {url}",
      pause: "{prefix}pause",
      resume: "{prefix}play",
      skip: "{prefix}skip",
      repeat: "{prefix}repeat on",
      shuffle: "{prefix}shuffle",
      queue: "{prefix}queue",
      nowPlaying: "{prefix}nowplaying",
      stop: "{prefix}stop",
    },
  },
  {
    id: "musicbot",
    label: "MusicBot (just-some-bots)",
    prefix: "!",
    note: "Self-hosted. No previous command.",
    commands: {
      play: "{prefix}play {url}",
      pause: "{prefix}pause",
      resume: "{prefix}resume",
      skip: "{prefix}skip",
      repeat: "{prefix}repeat all",
      shuffle: "{prefix}shuffle",
      queue: "{prefix}queue",
      nowPlaying: "{prefix}np",
      stop: "{prefix}disconnect",
    },
  },
  {
    id: "custom",
    label: "Custom bot",
    prefix: "!",
    note: "Edit the prefix and templates to match your bot's help output.",
    commands: {
      play: "{prefix}play {url}",
      pause: "{prefix}pause",
      resume: "{prefix}resume",
      skip: "{prefix}skip",
      previous: "{prefix}previous",
      repeat: "{prefix}repeat",
      shuffle: "{prefix}shuffle",
      queue: "{prefix}queue",
      nowPlaying: "{prefix}np",
      stop: "{prefix}stop",
    },
  },
];

const ICONS = {
  play: "M8 5v14l11-7z",
  pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
  prev: "M6 6h2v12H6zm3.5 6 8.5 6V6l-8.5 6z",
  next: "M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z",
  shuffle: "M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z",
  repeat: "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z",
  search: "M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z",
  list: "M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z",
  queue: "M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18a3 3 0 1 0 3 3V8h3V6h-5z",
  close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z",
  dotsVertical: "M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  send: "M2.01 21 23 12 2.01 3 2 10l15 2-15 2z",
  back: "M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12l4.58-4.59z",
  plus: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  trash: "M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  youtube: "M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.5 15.5v-7l6.5 3.5-6.5 3.5z",
  volume: "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z",
  external: "M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z",
};

function icon(name, size) {
  const px = size || 16;
  return h("svg", {
    viewBox: "0 0 24 24",
    width: px,
    height: px,
    fill: "currentColor",
    "aria-hidden": "true",
  }, h("path", { d: ICONS[name] || ICONS.play }));
}

function fmtTime(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
}

const CSS = `
#youtubepanel-root { position: fixed; inset: 0; pointer-events: none; z-index: 151; }
#youtubepanel-panel {
  position: fixed;
  top: 12px;
  right: var(--gap, 12px);
  display: flex;
  flex-direction: column;
  width: 420px;
  background: rgba(47, 47, 47, 0.94);
  backdrop-filter: blur(6px) saturate(110%);
  color: #dbdee1;
  border: var(--border-thickness, 2px) solid var(--border-subtle, rgba(255, 255, 255, 0.2));
  box-sizing: border-box;
  pointer-events: auto;
  overflow: visible;
  font-family: var(--font, var(--font-primary, "gg sans", "Noto Sans", sans-serif));
}
#youtubepanel-panel.yp-hidden { display: none; }
.yp-edge { position: absolute; left: 0; top: 0; bottom: 0; width: 6px; z-index: 4; }
.yp-resize { position: absolute; left: 0; right: 0; bottom: -5px; height: 10px; cursor: ns-resize; z-index: 5; }
.yp-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 34px 16px 12px; }
.yp-brand { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: #fff; }
.yp-brand svg { color: #ff0033; }
.yp-nav-right { display: flex; align-items: center; gap: 4px; }
.yp-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border: 0; border-radius: 50%;
  background: transparent; color: #b3b3b3; cursor: pointer;
}
.yp-btn:hover { color: #fff; background: rgba(255, 255, 255, 0.08); }
.yp-btn.yp-active { color: #ff4d6d; }
.yp-body { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0 16px 12px; gap: 10px; }
.yp-now { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; overflow-y: auto; }
.yp-cover { width: min(100%, 260px); aspect-ratio: 1 / 1; object-fit: cover; border-radius: 8px; background: #1f1f1f; }
.yp-cover-empty { display: flex; align-items: center; justify-content: center; color: #555; }
.yp-title { font-size: 18px; font-weight: 700; color: #fff; text-align: center; line-height: 1.25; }
.yp-artist { font-size: 12px; color: #aaa; text-align: center; }
.yp-progress-row { width: 100%; display: flex; flex-direction: column; gap: 2px; }
.yp-progress { height: 12px; display: flex; align-items: center; cursor: pointer; }
.yp-bar { position: relative; width: 100%; height: 3px; background: rgba(255, 255, 255, 0.24); }
.yp-fill { position: absolute; left: 0; top: 0; height: 100%; background: #ff0033; }
.yp-times { display: flex; justify-content: space-between; font-size: 9px; color: #8a8a8a; }
.yp-controls { display: flex; align-items: center; justify-content: center; gap: 18px; width: 100%; }
.yp-main { width: 56px; height: 56px; border-radius: 50%; background: #fff; color: #111; }
.yp-main:hover { background: #f0f0f0; color: #111; }
.yp-send { color: #1db954; }
.yp-volume { display: flex; align-items: center; gap: 8px; width: 100%; color: #888; }
.yp-volume input { flex: 1; accent-color: #ff0033; }
.yp-mini {
  display: flex; align-items: center; gap: 8px; margin-top: auto;
  padding: 8px; background: rgba(255, 255, 255, 0.05); border-radius: 6px; cursor: pointer;
}
.yp-mini img, .yp-mini-art { width: 34px; height: 34px; object-fit: cover; border-radius: 4px; background: #222; flex: 0 0 auto; }
.yp-mini-main { min-width: 0; flex: 1; }
.yp-mini-title { font-size: 11px; font-weight: 700; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yp-mini-sub { font-size: 10px; color: #8a8a8a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yp-scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.yp-search-row { display: flex; gap: 8px; padding: 4px 0; }
.yp-input {
  flex: 1; min-width: 0; background: #262626; border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 4px; color: #fff; font: inherit; font-size: 12px; padding: 6px 8px; outline: none;
}
.yp-input:focus { border-color: #ff0033; }
.yp-select {
  width: 100%; box-sizing: border-box; background: #262626; border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 4px; color: #fff; font: inherit; font-size: 12px; padding: 6px 8px; outline: none;
}
.yp-row { display: flex; align-items: center; gap: 8px; padding: 6px 4px; border-radius: 4px; cursor: pointer; }
.yp-row:hover { background: rgba(255, 255, 255, 0.06); }
.yp-row.yp-current { background: rgba(255, 0, 51, 0.10); }
.yp-row img, .yp-row-art { width: 38px; height: 38px; object-fit: cover; border-radius: 3px; background: #222; flex: 0 0 auto; }
.yp-row-main { min-width: 0; flex: 1; }
.yp-row-title { font-size: 12px; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yp-row-sub { font-size: 10px; color: #8a8a8a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yp-row-btn { width: 26px; height: 26px; border: 0; background: transparent; color: #777; cursor: pointer; flex: 0 0 auto; }
.yp-row-btn:hover { color: #fff; }
.yp-empty { padding: 26px 12px; text-align: center; color: #888; font-size: 12px; line-height: 1.5; }
.yp-error { color: #f0b232; font-size: 10.5px; line-height: 1.35; word-break: break-word; }
.yp-notice { color: #1db954; font-size: 10.5px; line-height: 1.35; word-break: break-word; }
.yp-label { font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: #888; }
.yp-hint { font-size: 10.5px; line-height: 1.4; color: #888; word-break: break-word; }
.yp-ok { color: #1db954; }
.yp-bad { color: #f0b232; }
.yp-primary {
  align-self: flex-start; border: 0; border-radius: 999px; background: #1db954;
  color: #0b0b0b; font: inherit; font-size: 12px; font-weight: 700; padding: 7px 16px; cursor: pointer;
}
.yp-primary:disabled { opacity: 0.5; cursor: default; }
.yp-textbtn { border: 0; background: transparent; color: #1db954; font: inherit; font-size: 11.5px; padding: 4px 2px; cursor: pointer; }
.yp-textbtn:hover { color: #1ed760; }
.yp-row2 { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.yp-sep { height: 1px; background: rgba(255, 255, 255, 0.08); margin: 6px 0; }
.yp-menu {
  position: absolute; top: 46px; right: 16px; z-index: 20; width: 210px; box-sizing: border-box;
  padding: 8px; background: #1c1c1c; border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px; box-shadow: 0 12px 28px rgba(0, 0, 0, 0.55);
}
.yp-menu-item {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; box-sizing: border-box; padding: 8px 10px; border: 0; border-radius: 6px;
  background: transparent; color: #e6e6e6; font: inherit; font-size: 12.5px; text-align: left; cursor: pointer;
}
.yp-menu-item:hover { background: rgba(255, 255, 255, 0.06); }
.yp-menu-sep { height: 1px; background: rgba(255, 255, 255, 0.08); margin: 6px 4px; }
.yp-botmenu-backdrop { position: absolute; inset: 0; z-index: 29; background: rgba(0, 0, 0, 0.45); }
.yp-botmenu {
  position: absolute; left: 10px; right: 10px; bottom: 92px; z-index: 30;
  max-height: calc(100% - 104px); overflow-y: auto; box-sizing: border-box;
  padding: 8px; background: #1c1c1c; border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px; box-shadow: 0 12px 28px rgba(0, 0, 0, 0.6);
}
.yp-botmenu-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 4px 8px; }
.yp-botmenu-title { font-size: 12.5px; font-weight: 700; color: #fff; }
.yp-botmenu-sub { font-size: 10px; color: #8a8a8a; margin-top: 1px; }
.yp-botmenu-notice { padding: 0 8px 8px; font-size: 10.5px; line-height: 1.35; word-break: break-word; }
.yp-botmenu-item {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  width: 100%; box-sizing: border-box; padding: 7px 8px; border: 0; border-radius: 6px;
  background: transparent; color: #e6e6e6; font: inherit; font-size: 12px; text-align: left; cursor: pointer;
}
.yp-botmenu-item:hover { background: rgba(255, 255, 255, 0.07); }
.yp-botmenu-item > span:first-child { min-width: 0; }
.yp-botmenu-cmd {
  max-width: 62%; overflow-wrap: anywhere; font-family: ui-monospace, Consolas, monospace;
  font-size: 10px; color: #8f8f8f; text-align: right;
}
.yp-botmenu-custom { display: flex; flex-direction: column; gap: 6px; padding: 6px 4px 2px; }
.yp-botmenu-custom-row { display: flex; align-items: center; gap: 8px; }
.yp-settings { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 2px 0 12px; }
.yp-template-list { display: flex; flex-direction: column; gap: 8px; padding: 2px 0; }
.yp-template-row { display: flex; flex-direction: column; gap: 3px; }
`;

// ------------------------------------------------------------------ helpers
async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  return false;
}

function openExternal(url) {
  try {
    if (typeof require === "function") {
      const { shell } = require("electron");
      if (shell && shell.openExternal) { shell.openExternal(url); return true; }
    }
  } catch {}
  try {
    const a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
    document.body.appendChild(a); a.click(); a.remove();
    return true;
  } catch {}
  return false;
}

// ------------------------------------------------------------------- plugin
class YouTubePanel {
  constructor(meta) {
    this.meta = meta;
    this.bd = typeof BdApi === "function" ? new BdApi(PLUGIN) : BdApi;
    this.settings = { ...DEFAULT_SETTINGS, ...(this.bd.Data.load("settings") || {}) };
    // v0.1.1: move the previous Alt+Y default to Alt+Q. A custom binding is
    // left alone unless it is exactly the old default.
    const hk = Array.isArray(this.settings.hotkey) ? this.settings.hotkey : [];
    if (hk.length === 2 && String(hk[0]).toLowerCase() === "alt" && String(hk[1]).toLowerCase() === "y") {
      this.settings.hotkey = ["Alt", "q"];
      this.save();
    }
    this._bump = null;
    this._reactRoot = null;
    this._rootEl = null;
    this._hotKeys = new Set();
    this._hotFired = false;
    this._sendChain = null;
  }

  log(...args) {
    try { (this.bd?.Logger || BdApi.Logger).info("[youtube]", ...args); } catch {}
  }

  save() {
    try { this.bd.Data.save("settings", this.settings); } catch {}
  }

  // ------------------------------------------------------------- sidecar API
  async api(path, options = {}) {
    const base = String(this.settings.sidecarUrl || DEFAULT_SETTINGS.sidecarUrl).replace(/\/+$/, "");
    const headers = { "X-Panel-Token": String(this.settings.sidecarToken || DEFAULT_SETTINGS.sidecarToken) };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    let res;
    try {
      res = await fetch(base + path, {
        method: options.method || "GET",
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    } catch (e) {
      throw new Error("sidecar offline at " + base + " - start tools/youtube-sidecar/start-youtube-panel.cmd");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = String(data.error || ("sidecar HTTP " + res.status));
      this.log("sidecar " + path + " failed (" + res.status + "): " + message);
      if (/448|untrusted mount point/i.test(message)) {
        throw new Error("Windows error 448: this path is not trusted. Reinstall YouTubePanel in a normal local folder, for example C:\\Users\\Public\\YouTubePanel.");
      }
      throw new Error(message);
    }
    return data;
  }

  health() { return this.api("/health"); }
  state() { return this.api("/state"); }
  search(q) { return this.api("/search?q=" + encodeURIComponent(q)); }
  play(input) { return this.api("/play", { method: "POST", body: input }); }
  playPlaylist(url) { return this.api("/playlist", { method: "POST", body: { url } }); }
  addQueue(input) { return this.api("/queue/add", { method: "POST", body: input }); }
  removeQueue(index) { return this.api("/queue/remove", { method: "POST", body: { index } }); }
  jump(index) { return this.api("/jump", { method: "POST", body: { index } }); }
  pause() { return this.api("/pause", { method: "POST" }); }
  resume() { return this.api("/resume", { method: "POST" }); }
  next() { return this.api("/next", { method: "POST" }); }
  previous() { return this.api("/previous", { method: "POST" }); }
  seek(seconds) { return this.api("/seek", { method: "POST", body: { seconds } }); }
  setVolume(percent) { return this.api("/volume", { method: "POST", body: { percent } }); }
  shuffle() { return this.api("/shuffle", { method: "POST" }); }
  repeat(state) { return this.api("/repeat", { method: "POST", body: state ? { state } : {} }); }
  stop() { return this.api("/stop", { method: "POST" }); }
  clearQueue() { return this.api("/clear", { method: "POST" }); }

  // --------------------------------------------------------- discord bridge
  musicBotProfile() {
    const preset = MUSIC_BOTS.find((b) => b.id === this.settings.musicBotId) || MUSIC_BOTS[0];
    const overrides = this.settings.musicBotCommands;
    const commands = { ...preset.commands };
    if (overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
      for (const action of MUSIC_BOT_ACTIONS) {
        if (Object.prototype.hasOwnProperty.call(overrides, action.id)) {
          commands[action.id] = overrides[action.id] == null ? "" : String(overrides[action.id]);
        }
      }
    }
    return {
      id: preset.id,
      label: preset.label,
      note: preset.note,
      prefix: String(this.settings.musicBotPrefix || preset.prefix),
      commands,
    };
  }

  musicBotActionList() {
    const profile = this.musicBotProfile();
    return MUSIC_BOT_ACTIONS
      .filter((a) => String(profile.commands[a.id] || "").trim())
      .map((a) => ({ ...a, template: String(profile.commands[a.id]).trim() }));
  }

  musicBotVars(track) {
    const title = track?.title || track?.name || "";
    const artist = track?.artist || (Array.isArray(track?.artists) ? track.artists.map((a) => a && a.name).filter(Boolean).join(", ") : "");
    return {
      prefix: this.musicBotProfile().prefix,
      query: [title, artist].filter(Boolean).join(" ").trim(),
      title,
      artist,
      artists: artist,
      album: track?.album || "",
      url: track?.url || track?.webpage_url || "",
      uri: track?.uri || "",
    };
  }

  formatMusicCommand(action, track) {
    const profile = this.musicBotProfile();
    const template = profile.commands[action];
    if (!template || !String(template).trim()) return "";
    const vars = this.musicBotVars(track);
    return String(template)
      .replace(/\{(\w+)\}/g, (m, key) => (Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : m))
      .replace(/\s+/g, " ")
      .trim();
  }

  messageModule() {
    try {
      const wp = BdApi.Webpack;
      if (!wp) return null;
      const byKeys = wp.getByKeys && wp.getByKeys("sendMessage", "receiveMessage");
      if (byKeys && typeof byKeys.sendMessage === "function") return byKeys;
      const byProps = wp.getByProps && wp.getByProps("sendMessage");
      if (byProps && typeof byProps.sendMessage === "function") return byProps;
      const found = wp.getModule && wp.getModule((m) => m && typeof m.sendMessage === "function", { searchExports: true });
      return found && typeof found.sendMessage === "function" ? found : null;
    } catch {
      return null;
    }
  }

  enqueueMusicSend(channelId, content) {
    const job = () => this.deliverMusicMessage(channelId, content);
    const run = (this._sendChain || Promise.resolve()).then(job, job);
    this._sendChain = run.catch(() => {});
    return run;
  }

  async deliverMusicMessage(channelId, content) {
    const actions = this.messageModule();
    if (!actions) return { ok: false, error: "could not reach discord's message module", content };
    try {
      const out = actions.sendMessage(channelId, { content }, undefined, {});
      if (out && typeof out.then === "function") {
        const res = await out.catch((e) => ({ error: e }));
        if (res && res.error) return { ok: false, error: res.error.message || "send failed", content };
      }
      this.log("sent bot command: " + content + " to " + channelId);
      return { ok: true, content };
    } catch (e) {
      return { ok: false, error: e?.message || "send failed", content };
    }
  }

  sendMusicCommand(action, track) {
    const channelId = String(this.settings.musicChannelId || "").trim();
    if (!channelId) return Promise.resolve({ ok: false, error: "set a music channel id in the panel settings" });
    if (action === "play" && !track?.title && !track?.url) return Promise.resolve({ ok: false, error: "nothing playing" });
    const content = this.formatMusicCommand(action, track);
    if (!content) return Promise.resolve({ ok: false, error: "this bot has no " + action + " command configured" });
    return this.enqueueMusicSend(channelId, content);
  }

  sendRawMusicCommand(text) {
    const channelId = String(this.settings.musicChannelId || "").trim();
    if (!channelId) return Promise.resolve({ ok: false, error: "set a music channel id in the panel settings" });
    const content = String(text || "").trim();
    if (!content) return Promise.resolve({ ok: false, error: "command is empty" });
    return this.enqueueMusicSend(channelId, content);
  }

  currentChannelId() {
    try {
      const wp = BdApi.Webpack;
      if (!wp) return "";
      const store = (wp.getByProps && wp.getByProps("getChannelId", "getLastSelectedChannelId"))
        || (wp.getByProps && wp.getByProps("getChannelId"));
      const id = store && store.getChannelId && store.getChannelId();
      return id ? String(id) : "";
    } catch {
      return "";
    }
  }

  // -------------------------------------------------------------- lifecycle
  registerPanel() {
    try {
      window.__jcodePanels = window.__jcodePanels || {};
      window.__jcodePanels.youtube = { hide: () => this.hidePanel() };
    } catch {}
  }

  unregisterPanel() {
    try {
      if (window.__jcodePanels) delete window.__jcodePanels.youtube;
    } catch {}
  }

  hidePanel() {
    if (!this.settings.visible) return;
    this.settings.visible = false;
    this.save();
    try { document.querySelectorAll("#youtubepanel-panel").forEach((el) => el.classList.add("yp-hidden")); } catch {}
    this._bump?.();
  }

  hideOtherPanels() {
    try {
      const reg = window.__jcodePanels || {};
      for (const key of Object.keys(reg)) {
        if (key === "youtube") continue;
        try { reg[key]?.hide?.(); } catch {}
      }
    } catch {}
  }

  togglePanel() {
    this.settings.visible = !this.settings.visible;
    if (this.settings.visible) this.hideOtherPanels();
    this.save();
    try {
      document.querySelectorAll("#youtubepanel-panel").forEach((el) => {
        el.classList.toggle("yp-hidden", !this.settings.visible);
      });
    } catch {}
    this._bump?.();
  }

  startHotkey() {
    this.stopHotkey();
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    this._hotAbort = controller;
    const options = controller ? { capture: true, signal: controller.signal } : true;
    const keydown = (e) => {
      if (!e.key || e.repeat) return;
      this._hotKeys.add(String(e.key).toLowerCase());
      this._checkHotkey();
    };
    const keyup = (e) => {
      if (e.key) this._hotKeys.delete(String(e.key).toLowerCase());
    };
    const clear = () => this._hotKeys.clear();
    document.addEventListener("keydown", keydown, options);
    document.addEventListener("keyup", keyup, options);
    window.addEventListener("blur", clear);
    this._hotCleanup = () => {
      document.removeEventListener("keydown", keydown, options);
      document.removeEventListener("keyup", keyup, options);
      window.removeEventListener("blur", clear);
    };
  }

  stopHotkey() {
    try { this._hotCleanup?.(); } catch {}
    this._hotCleanup = null;
    try { this._hotAbort?.abort(); } catch {}
    this._hotAbort = null;
    this._hotKeys.clear();
    this._hotFired = false;
  }

  _checkHotkey() {
    const combo = (this.settings.hotkey || []).map((k) => String(k).toLowerCase());
    if (!combo.length || this._hotKeys.size !== combo.length) return;
    if (!combo.every((k) => this._hotKeys.has(k))) return;
    this._hotFired = true;
    this.togglePanel();
  }

  mount() {
    try { document.querySelectorAll("#youtubepanel-root").forEach((el) => el.remove()); } catch {}
    const RD = BdApi.ReactDOM || (() => {
      try { return BdApi.Webpack.getByKeys?.("createRoot") || null; } catch { return null; }
    })();
    this._rootEl = document.createElement("div");
    this._rootEl.id = "youtubepanel-root";
    document.body.appendChild(this._rootEl);
    const element = h(Boundary, { plugin: this }, h(App, { plugin: this }));
    if (RD?.createRoot) {
      this._reactRoot = RD.createRoot(this._rootEl);
      this._reactRoot.render(element);
    } else if (RD?.render) {
      RD.render(element, this._rootEl);
    } else {
      this.log("ReactDOM unavailable; panel not mounted");
    }
  }

  unmount() {
    try { this._reactRoot?.unmount(); } catch {}
    this._reactRoot = null;
    try { this._rootEl?.remove(); } catch {}
    this._rootEl = null;
  }

  start() {
    this.registerPanel();
    BdApi.DOM.addStyle("YouTubePanel-css", CSS);
    this.startHotkey();
    if (this.settings.visible) this.hideOtherPanels();
    this.mount();
    this.log("started; visible=" + this.settings.visible);
  }

  stop() {
    this.unregisterPanel();
    try { BdApi.DOM.removeStyle("YouTubePanel-css"); } catch {}
    this.stopHotkey();
    this.unmount();
    this.log("stopped");
  }

  getSettingsPanel() {
    return this.bd.UI.buildSettingsPanel({
      settings: [
        {
          type: "textbox",
          id: "sidecarUrl",
          name: "Sidecar URL",
          note: "Run tools/youtube-sidecar/start-youtube-panel.cmd. Default http://127.0.0.1:8910",
          value: this.settings.sidecarUrl,
        },
        {
          type: "textbox",
          id: "sidecarToken",
          name: "Sidecar token",
          note: "Must match config.json. Default youtube-panel.",
          value: this.settings.sidecarToken,
        },
        {
          type: "textbox",
          id: "musicChannelId",
          name: "Music channel ID",
          value: this.settings.musicChannelId,
          note: "Channel the Send button posts to. Developer Mode > Copy Channel ID.",
        },
        {
          type: "dropdown",
          id: "musicBotId",
          name: "Discord music bot",
          value: MUSIC_BOTS.some((b) => b.id === this.settings.musicBotId) ? this.settings.musicBotId : MUSIC_BOTS[0].id,
          options: MUSIC_BOTS.map((b) => ({ label: b.label, value: b.id })),
        },
        {
          type: "textbox",
          id: "musicBotPrefix",
          name: "Bot command prefix",
          note: "Blank uses the preset. Include a trailing space for @Bot ",
          value: this.settings.musicBotPrefix,
        },
        {
          type: "textbox",
          id: "musicBotCommands",
          name: "Command overrides (JSON)",
          note: 'e.g. {"play":"{prefix}play {url}"}. Actions: play, pause, resume, skip, previous, repeat, shuffle, queue, nowPlaying, stop.',
          value: JSON.stringify(this.settings.musicBotCommands || {}),
        },
        {
          type: "number",
          id: "height",
          name: "Panel height (px)",
          value: this.settings.height,
        },
        {
          type: "textbox",
          id: "hotkey",
          name: "Hotkey",
          note: "Comma separated, e.g. Alt,q",
          value: (this.settings.hotkey || []).join(","),
        },
      ],
      onChange: (category, id, value) => {
        if (id === "hotkey") this.settings.hotkey = String(value).split(",").map((s) => s.trim()).filter(Boolean);
        else if (id === "height") this.settings.height = Math.max(180, Math.min(560, Number(value) || 330));
        else if (id === "musicBotCommands") {
          const raw = String(value || "").trim();
          if (!raw) this.settings.musicBotCommands = {};
          else {
            try {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) this.settings.musicBotCommands = parsed;
            } catch {}
          }
        } else if (id === "musicBotId") {
          this.settings.musicBotId = String(value || "jockie");
          this.settings.musicBotPrefix = "";
          this.settings.musicBotCommands = {};
        } else this.settings[id] = value;
        this.save();
        this._bump?.();
      },
    });
  }
}

// -------------------------------------------------------------------- React
class Boundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { try { this.props.plugin?.log("render error: " + (error?.message || error)); } catch {} }
  render() {
    if (this.state.error) {
      return h("div", { className: "yp-error", style: { padding: "16px" } },
        "YouTubePanel render error: " + (this.state.error.message || String(this.state.error)));
    }
    return this.props.children;
  }
}

function App({ plugin }) {
  const [, force] = useReducer((x) => x + 1, 0);
  const [state, setState] = useState(null);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState("now");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [urlDraft, setUrlDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [volume, setVolume] = useState(Number(plugin.settings.volume) || 70);
  const [channelDraft, setChannelDraft] = useState(String(plugin.settings.musicChannelId || ""));
  const [sidecarDraft, setSidecarDraft] = useState(String(plugin.settings.sidecarUrl || ""));
  const [tokenDraft, setTokenDraft] = useState(String(plugin.settings.sidecarToken || ""));
  const [showTemplates, setShowTemplates] = useState(false);
  const [botMenuOpen, setBotMenuOpen] = useState(false);
  const [botNotice, setBotNotice] = useState(null);
  const [customCommand, setCustomCommand] = useState("");
  const [showCustomCommand, setShowCustomCommand] = useState(false);
  const [, setTick] = useState(0);
  const fetchedAt = useRef(0);
  const volTimer = useRef(0);
  const volumeInit = useRef(false);

  useEffect(() => {
    plugin._bump = force;
    return () => { if (plugin._bump === force) plugin._bump = null; };
  }, []);

  const refresh = async () => {
    try {
      const next = await plugin.state();
      fetchedAt.current = Date.now();
      setState(next);
      setHealth({ mpv: next.mpv, ytdlp: next.ytdlp, mpvError: next.mpvError });
      setError(next.mpvError && !next.mpv ? next.mpvError : null);
    } catch (e) {
      setError(e?.message || "sidecar offline");
    }
  };

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const next = await plugin.state();
        if (!alive) return;
        fetchedAt.current = Date.now();
        setState(next);
        setHealth({ mpv: next.mpv, ytdlp: next.ytdlp, mpvError: next.mpvError });
        setError(next.mpvError && !next.mpv ? next.mpvError : null);
      } catch (e) {
        if (!alive) return;
        setError(e?.message || "sidecar offline");
      }
    };
    load();
    const id = setInterval(load, 1000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!botMenuOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") { setBotMenuOpen(false); setShowCustomCommand(false); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [botMenuOpen]);

  useEffect(() => {
    if (!volumeInit.current && state && typeof state.volume === "number") {
      volumeInit.current = true;
      const saved = Number(plugin.settings.volume);
      if (Number.isFinite(saved) && saved !== state.volume) {
        plugin.setVolume(saved).catch(() => {});
        setVolume(saved);
      } else {
        setVolume(state.volume);
      }
    }
  }, [state]);

  const track = state?.track || null;
  const duration = Number(state?.duration || track?.duration || 0);
  const basePos = Number(state?.position || 0);
  const position = Math.min(
    duration || Number.MAX_SAFE_INTEGER,
    basePos + (state?.isPlaying ? Math.max(0, Date.now() - fetchedAt.current) / 1000 : 0)
  );
  const pct = duration ? Math.max(0, Math.min(100, (position / duration) * 100)) : 0;
  const cover = track?.thumbnail || "";
  // Match SpotifyPanel's full-bleed artwork sizing: width-bound in full-height
  // mode, height-bound when the panel is manually resized.
  const panelHeight = Number(plugin.settings.height) || 330;
  const viewportH = (typeof window !== "undefined" && window.innerHeight) ? window.innerHeight : panelHeight + 24;
  const viewportW = (typeof window !== "undefined" && window.innerWidth) ? window.innerWidth : 1280;
  const panelWidth = Math.min(Number(plugin.settings.width) || 420, viewportW - 24);
  const panelBoxH = plugin.settings.fullHeight ? viewportH - 24 : panelHeight;
  const availableH = panelBoxH - 392;
  const artSize = Math.max(96, Math.min(Math.round(panelWidth - 48), availableH));
  const queue = state?.queue || { items: [], index: -1, upcoming: [] };

  const flashNotice = (text, ms = 4000) => {
    setNotice(text);
    setTimeout(() => setNotice(""), ms);
  };

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e?.message || "command failed");
    } finally {
      setBusy(false);
    }
  };

  const togglePlay = () => {
    if (!state) return;
    if (state.isPlaying) run(() => plugin.pause());
    else run(() => plugin.resume());
  };

  const changeVolume = (value) => {
    const next = Math.max(0, Math.min(100, Math.round(value)));
    setVolume(next);
    plugin.settings.volume = next;
    plugin.save();
    clearTimeout(volTimer.current);
    volTimer.current = setTimeout(() => { plugin.setVolume(next).catch(() => {}); }, 160);
  };

  const seek = (e) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    run(() => plugin.seek(duration * ratio));
  };

  const doSearch = async () => {
    const q = query.trim();
    if (!q) { setResults(null); return; }
    setSearching(true);
    setError(null);
    try {
      const data = await plugin.search(q);
      setResults(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setResults([]);
      setError(e?.message || "search failed");
    } finally {
      setSearching(false);
    }
  };

  const playTrack = async (t) => {
    if (!t?.url) return;
    await run(() => plugin.play({ url: t.url }));
    setView("now");
  };

  const addQueue = async (t) => {
    if (!t?.url) return;
    await run(() => plugin.addQueue({ url: t.url }));
    flashNotice("added to queue");
  };

  const playUrl = async () => {
    const url = urlDraft.trim();
    if (!url) { flashNotice("paste a YouTube or playlist URL"); return; }
    await run(() => plugin.play({ url }));
    setView("now");
  };

  const queuePlaylist = async () => {
    const url = urlDraft.trim();
    if (!url) { flashNotice("paste a playlist URL"); return; }
    await run(() => plugin.playPlaylist(url));
    setView("now");
  };

  const jumpTo = async (index) => {
    await run(() => plugin.jump(index));
    setView("now");
  };

  const clearQueue = async () => {
    await run(() => plugin.clearQueue());
    flashNotice("queue cleared");
  };

  // ----------------------------------------------------------- bot commands
  const botProfile = plugin.musicBotProfile();
  const botActions = plugin.musicBotActionList();
  const configuredBotId = String(plugin.settings.musicBotId || "jockie");
  const activeBotId = MUSIC_BOTS.some((b) => b.id === configuredBotId) ? configuredBotId : MUSIC_BOTS[0].id;
  const botOverrides = (plugin.settings.musicBotCommands && typeof plugin.settings.musicBotCommands === "object" && !Array.isArray(plugin.settings.musicBotCommands))
    ? plugin.settings.musicBotCommands
    : {};
  const previewTrack = track || { title: "<title>", artist: "<artist>", url: "https://youtu.be/<id>" };
  const playPreview = plugin.formatMusicCommand("play", previewTrack) || "(no play command configured)";

  const chooseBot = (id) => {
    plugin.settings.musicBotId = id;
    plugin.settings.musicBotPrefix = "";
    plugin.settings.musicBotCommands = {};
    plugin.save();
    plugin._bump?.();
  };

  const changeBotPrefix = (value) => {
    plugin.settings.musicBotPrefix = value;
    plugin.save();
    plugin._bump?.();
  };

  const changeBotTemplate = (action, value) => {
    const current = plugin.settings.musicBotCommands;
    const base = current && typeof current === "object" && !Array.isArray(current) ? current : {};
    plugin.settings.musicBotCommands = { ...base, [action]: value };
    plugin.save();
    plugin._bump?.();
  };

  const resetBotTemplates = () => {
    plugin.settings.musicBotCommands = {};
    plugin.save();
    plugin._bump?.();
  };

  const sendBotCommand = async (action) => {
    const res = await plugin.sendMusicCommand(action, track);
    const text = res.ok ? "sent " + res.content : (res.error || "send failed");
    setBotNotice({ ok: !!res.ok, text });
    flashNotice(text, res.ok ? 3000 : 5000);
  };

  const sendBotRaw = async () => {
    const res = await plugin.sendRawMusicCommand(customCommand);
    if (!res.ok) {
      setBotNotice({ ok: false, text: res.error || "send failed" });
      flashNotice(res.error || "send failed", 5000);
      return;
    }
    flashNotice("sent " + res.content, 3000);
    setCustomCommand("");
    setShowCustomCommand(false);
    setBotMenuOpen(false);
  };

  const saveSidecar = () => {
    plugin.settings.sidecarUrl = sidecarDraft.trim() || DEFAULT_SETTINGS.sidecarUrl;
    plugin.settings.sidecarToken = tokenDraft.trim() || DEFAULT_SETTINGS.sidecarToken;
    plugin.save();
    setError(null);
    flashNotice("sidecar settings saved");
    plugin.health().then((h) => { setHealth(h); flashNotice("sidecar connected"); })
      .catch((e) => setError(e?.message || "sidecar offline"));
  };

  const testSidecar = () => {
    plugin.settings.sidecarUrl = sidecarDraft.trim() || DEFAULT_SETTINGS.sidecarUrl;
    plugin.settings.sidecarToken = tokenDraft.trim() || DEFAULT_SETTINGS.sidecarToken;
    plugin.save();
    plugin.health().then((h) => { setHealth(h); setError(null); flashNotice("sidecar connected"); })
      .catch((e) => setError(e?.message || "sidecar offline"));
  };

  const saveChannel = () => {
    plugin.settings.musicChannelId = channelDraft.trim();
    plugin.save();
    flashNotice("music channel saved", 3000);
  };

  const startCommand = 'start "" "%APPDATA%\\BetterDiscord\\plugins\\tools\\youtube-sidecar\\start-youtube-panel.cmd"';

  // ---------------------------------------------------------------- views
  const miniBar = h("div", {
    className: "yp-mini",
    title: "Back to player",
    onClick: () => setView("now"),
  },
    cover ? h("img", { src: cover, alt: "" }) : h("div", { className: "yp-mini-art" }),
    h("div", { className: "yp-mini-main" },
      h("div", { className: "yp-mini-title" }, track ? track.title : "Nothing playing"),
      h("div", { className: "yp-mini-sub" }, track ? (track.artist || "YouTube") : "start the sidecar")),
    h("button", {
      className: "yp-btn",
      title: state?.isPlaying ? "Pause" : "Play",
      onClick: (e) => { e.stopPropagation(); togglePlay(); },
    }, icon(state?.isPlaying ? "pause" : "play", 16)),
    h("button", {
      className: "yp-btn",
      title: "Search",
      onClick: (e) => { e.stopPropagation(); setView("search"); },
    }, icon("search", 16))
  );

  const nowNode = h("div", { className: "yp-body" },
    h("div", { className: "yp-now" },
      cover
        ? h("img", { className: "yp-cover", src: cover, alt: "", style: { width: artSize + "px", height: artSize + "px" } })
        : h("div", { className: "yp-cover yp-cover-empty", style: { width: artSize + "px", height: artSize + "px" } }, icon("youtube", 54)),
      h("div", { className: "yp-title" }, track ? track.title : "Nothing playing"),
      h("div", { className: "yp-artist" }, track ? (track.artist || "YouTube") : "Start the sidecar and search"),
      h("div", { className: "yp-progress-row" },
        h("div", { className: "yp-progress", onClick: seek },
          h("div", { className: "yp-bar" },
            h("div", { className: "yp-fill", style: { width: pct + "%" } }))),
        h("div", { className: "yp-times" },
          h("span", null, fmtTime(position * 1000)),
          h("span", null, fmtTime(duration * 1000)))),
      h("div", { className: "yp-controls" },
        h("button", {
          className: "yp-btn" + (state?.shuffle ? " yp-active" : ""),
          title: "Shuffle",
          onClick: () => run(() => plugin.shuffle()),
        }, icon("shuffle", 18)),
        h("button", { className: "yp-btn", title: "Previous", onClick: () => run(() => plugin.previous()) }, icon("prev", 22)),
        h("button", {
          className: "yp-btn yp-main",
          title: state?.isPlaying ? "Pause" : "Play",
          onClick: togglePlay,
        }, icon(state?.isPlaying ? "pause" : "play", 24)),
        h("button", { className: "yp-btn", title: "Next", onClick: () => run(() => plugin.next()) }, icon("next", 22)),
        h("button", {
          className: "yp-btn" + (state?.repeat && state.repeat !== "off" ? " yp-active" : ""),
          title: state?.repeat === "one" ? "Repeat one" : "Repeat",
          onClick: () => run(() => plugin.repeat()),
        }, icon("repeat", 18)),
        h("button", {
          className: "yp-btn yp-send",
          title: "Send play to your music channel - right-click for more",
          onClick: async () => {
            if (!track) { flashNotice("nothing playing", 3000); return; }
            await sendBotCommand("play");
          },
          onContextMenu: (e) => {
            e.preventDefault(); e.stopPropagation();
            setMenuOpen(false); setShowCustomCommand(false); setBotNotice(null); setBotMenuOpen(true);
          },
        }, icon("send", 18))),
      h("div", { className: "yp-volume" },
        icon("volume", 14),
        h("input", {
          type: "range", min: 0, max: 100, step: 1, value: volume,
          onChange: (e) => changeVolume(Number(e.target.value)),
        }))
    ),
    notice ? h("div", { className: "yp-notice" }, notice) : null,
    error ? h("div", { className: "yp-error" }, error) : null,
    miniBar
  );

  const row = (t, key, onPlay, onQueue, index, current) => h("div", {
    className: "yp-row" + (current ? " yp-current" : ""),
    key,
    onClick: onPlay,
    title: t.title,
  },
    t.thumbnail ? h("img", { src: t.thumbnail, alt: "" }) : h("div", { className: "yp-row-art" }),
    h("div", { className: "yp-row-main" },
      h("div", { className: "yp-row-title" }, t.title),
      h("div", { className: "yp-row-sub" }, (t.artist || "YouTube") + (t.duration ? " · " + fmtTime(t.duration * 1000) : ""))),
    onQueue ? h("button", {
      className: "yp-row-btn",
      title: "Add to queue",
      onClick: (e) => { e.stopPropagation(); onQueue(t); },
    }, icon("plus", 16)) : null,
    index != null ? h("button", {
      className: "yp-row-btn",
      title: "Remove",
      onClick: (e) => { e.stopPropagation(); run(() => plugin.removeQueue(index)); },
    }, icon("trash", 15)) : null
  );

  const searchNode = h("div", { className: "yp-body" },
    h("div", { className: "yp-search-row" },
      h("input", {
        className: "yp-input",
        placeholder: "Search YouTube",
        value: query,
        onChange: (e) => setQuery(e.target.value),
        onKeyDown: (e) => { if (e.key === "Enter") doSearch(); },
      }),
      h("button", { className: "yp-primary", disabled: searching, onClick: doSearch }, searching ? "..." : "Go")),
    h("div", { className: "yp-search-row" },
      h("input", {
        className: "yp-input",
        placeholder: "Paste YouTube / playlist URL",
        value: urlDraft,
        onChange: (e) => setUrlDraft(e.target.value),
        onKeyDown: (e) => { if (e.key === "Enter") playUrl(); },
      }),
      h("button", { className: "yp-textbtn", onClick: playUrl }, "Play URL"),
      h("button", { className: "yp-textbtn", onClick: queuePlaylist }, "Queue playlist")),
    h("div", { className: "yp-scroll" },
      results === null
        ? h("div", { className: "yp-empty" }, "Search YouTube or paste a URL above.")
        : results.length
          ? results.map((t) => row(t, t.id || t.url, () => playTrack(t), addQueue))
          : h("div", { className: "yp-empty" }, "No matches")),
    notice ? h("div", { className: "yp-notice" }, notice) : null,
    error ? h("div", { className: "yp-error" }, error) : null,
    miniBar
  );

  const queueNode = h("div", { className: "yp-body" },
    h("div", { className: "yp-row2" },
      h("div", { className: "yp-label" }, "Queue · " + queue.items.length),
      h("button", { className: "yp-textbtn", onClick: clearQueue }, "Clear")),
    h("div", { className: "yp-scroll" },
      queue.items.length
        ? queue.items.map((t, i) => row(
            t,
            (t.id || "q") + i,
            () => jumpTo(i),
            null,
            i,
            i === queue.index
          ))
        : h("div", { className: "yp-empty" }, "Queue is empty.")),
    notice ? h("div", { className: "yp-notice" }, notice) : null,
    error ? h("div", { className: "yp-error" }, error) : null,
    miniBar
  );

  const settingsNode = h("div", { className: "yp-body" },
    h("div", { className: "yp-settings" },
      h("div", { className: "yp-label" }, "YouTube sidecar"),
      h("div", { className: "yp-row2" },
        h("span", { className: "yp-hint " + (health?.mpv ? "yp-ok" : "yp-bad") },
          health ? (health.mpv ? "mpv connected" : "mpv missing") : "checking..."),
        h("span", { className: "yp-hint" }, "yt-dlp: " + (health?.ytdlp || "?") )),
      h("div", { className: "yp-hint" },
        "Run tools/youtube-sidecar/start-youtube-panel.cmd. Requires Node, yt-dlp and mpv."),
      h("div", { className: "yp-hint" }, "winget install yt-dlp.yt-dlp  ·  winget install shinchiro.mpv"),
      h("button", {
        className: "yp-textbtn",
        onClick: async () => {
          const ok = await copyText(startCommand);
          flashNotice(ok ? "start command copied" : "could not copy", 3000);
        },
      }, "Copy start command"),
      h("div", { className: "yp-label" }, "Sidecar URL"),
      h("input", { className: "yp-input", value: sidecarDraft, onChange: (e) => setSidecarDraft(e.target.value) }),
      h("div", { className: "yp-label" }, "Token"),
      h("input", { className: "yp-input", value: tokenDraft, onChange: (e) => setTokenDraft(e.target.value) }),
      h("div", { className: "yp-row2" },
        h("button", { className: "yp-primary", onClick: saveSidecar }, "Save & connect"),
        h("button", { className: "yp-textbtn", onClick: testSidecar }, "Test")),
      health?.mpvError ? h("div", { className: "yp-hint yp-bad" }, health.mpvError) : null,

      h("div", { className: "yp-sep" }),
      h("div", { className: "yp-label" }, "Discord music bot"),
      h("select", {
        className: "yp-select",
        value: activeBotId,
        onChange: (e) => chooseBot(e.target.value),
      }, MUSIC_BOTS.map((b) => h("option", { key: b.id, value: b.id }, b.label))),
      h("div", { className: "yp-hint" }, botProfile.note),
      h("div", { className: "yp-label" }, "Command prefix"),
      h("input", {
        className: "yp-input",
        placeholder: (MUSIC_BOTS.find((b) => b.id === activeBotId) || MUSIC_BOTS[0]).prefix,
        value: plugin.settings.musicBotPrefix || "",
        onChange: (e) => changeBotPrefix(e.target.value),
      }),
      h("div", { className: "yp-hint yp-ok" }, "Sends: " + playPreview),
      h("button", {
        className: "yp-textbtn",
        onClick: () => setShowTemplates(!showTemplates),
      }, showTemplates ? "Hide command templates" : "Edit command templates"),
      showTemplates
        ? h("div", { className: "yp-template-list" },
            h("div", { className: "yp-hint" },
              "Tokens: {prefix}, {query}, {title}, {artist}, {album}, {url}, {uri}"),
            MUSIC_BOT_ACTIONS.map((action) => {
              const overridden = Object.prototype.hasOwnProperty.call(botOverrides, action.id);
              const value = overridden
                ? String(botOverrides[action.id] == null ? "" : botOverrides[action.id])
                : (botProfile.commands[action.id] || "");
              return h("div", { className: "yp-template-row", key: action.id },
                h("div", { className: "yp-label" }, action.label),
                h("input", {
                  className: "yp-input",
                  value,
                  placeholder: "empty to hide this action",
                  onChange: (e) => changeBotTemplate(action.id, e.target.value),
                }));
            }),
            h("button", { className: "yp-textbtn", onClick: resetBotTemplates }, "Reset to preset"))
        : null,

      h("div", { className: "yp-sep" }),
      h("div", { className: "yp-label" }, "Discord channel"),
      h("input", {
        className: "yp-input",
        placeholder: "right-click the channel > Copy Channel ID",
        value: channelDraft,
        onChange: (e) => setChannelDraft(e.target.value),
      }),
      h("div", { className: "yp-row2" },
        h("button", {
          className: "yp-textbtn",
          onClick: () => { const id = plugin.currentChannelId(); if (id) setChannelDraft(id); },
        }, "Use current channel"),
        h("button", { className: "yp-textbtn", onClick: saveChannel }, "Save")),
      h("div", { className: "yp-hint" },
        "Commands are sent as you. The bot must be in this channel and accept prefix commands. Slash-only bots cannot be controlled this way."),
      notice ? h("div", { className: "yp-notice" }, notice) : null,
      error ? h("div", { className: "yp-error" }, error) : null
    )
  );

  const botMenuNode = botMenuOpen
    ? [
        h("div", {
          key: "backdrop",
          className: "yp-botmenu-backdrop",
          onClick: () => { setBotMenuOpen(false); setShowCustomCommand(false); },
        }),
        h("div", { key: "menu", className: "yp-botmenu" },
          h("div", { className: "yp-botmenu-head" },
            h("div", null,
              h("div", { className: "yp-botmenu-title" }, botProfile.label),
              h("div", { className: "yp-botmenu-sub" }, botProfile.prefix + " commands · sent as you")),
            h("button", {
              className: "yp-btn", title: "Close",
              onClick: () => { setBotMenuOpen(false); setShowCustomCommand(false); },
            }, icon("close", 16))),
          botNotice
            ? h("div", { className: "yp-botmenu-notice " + (botNotice.ok ? "yp-ok" : "yp-bad") }, botNotice.text)
            : null,
          botActions.map((action) => h("button", {
            key: action.id,
            className: "yp-botmenu-item",
            onClick: () => sendBotCommand(action.id),
          },
            h("span", null, action.label),
            h("span", { className: "yp-botmenu-cmd" },
              plugin.formatMusicCommand(action.id, track) || action.template))),
          showCustomCommand
            ? h("div", { className: "yp-botmenu-custom" },
                h("input", {
                  className: "yp-input",
                  placeholder: botProfile.prefix + "volume 20",
                  value: customCommand,
                  onChange: (e) => setCustomCommand(e.target.value),
                  onKeyDown: (e) => { if (e.key === "Enter") sendBotRaw(); },
                }),
                h("div", { className: "yp-botmenu-custom-row" },
                  h("button", { className: "yp-primary", onClick: sendBotRaw }, "Send"),
                  h("button", {
                    className: "yp-textbtn",
                    onClick: () => { setShowCustomCommand(false); setCustomCommand(""); },
                  }, "Cancel")))
            : h("button", {
                className: "yp-botmenu-item",
                onClick: () => setShowCustomCommand(true),
              },
                h("span", null, "Custom command..."),
                icon("send", 16)))
      ]
    : null;

  return h("div", {
    id: "youtubepanel-panel",
    className: (plugin.settings.visible ? "" : "yp-hidden"),
    style: {
      width: (Number(plugin.settings.width) || 420) + "px",
      ...(plugin.settings.fullHeight
        ? { bottom: (Number(plugin.settings.topOffset) || 12) + "px" }
        : { height: (Number(plugin.settings.height) || 330) + "px" }),
      top: (Number(plugin.settings.topOffset) || 12) + "px",
    },
  },
    h("div", { className: "yp-edge", onMouseDown: (e) => { e.preventDefault(); e.stopPropagation(); } }),
    h("div", { className: "yp-resize", onMouseDown: (e) => startResize(e, plugin) }),
    h("div", { className: "yp-nav" },
      h("button", {
        className: "yp-btn",
        title: view === "now" ? "Search" : "Back to player",
        onClick: () => setView(view === "now" ? "search" : "now"),
      }, icon("back", 20)),
      h("div", { className: "yp-brand" }, icon("youtube", 18), h("span", null, "YouTube")),
      h("div", { className: "yp-nav-right" },
        h("button", {
          className: "yp-btn" + (menuOpen ? " yp-active" : ""),
          title: "More",
          onClick: () => setMenuOpen(!menuOpen),
        }, icon("dotsVertical", 18)))),
    menuOpen
      ? h("div", { className: "yp-menu" },
          h("button", { className: "yp-menu-item", onClick: () => { setMenuOpen(false); setView("search"); } },
            h("span", null, "Search"), icon("search", 14)),
          h("button", { className: "yp-menu-item", onClick: () => { setMenuOpen(false); setView("queue"); } },
            h("span", null, "Queue"), icon("queue", 14)),
          h("button", { className: "yp-menu-item", onClick: () => { setMenuOpen(false); setView("settings"); } },
            h("span", null, "Panel settings"), icon("dotsVertical", 14)),
          h("div", { className: "yp-menu-sep" }),
          h("button", { className: "yp-menu-item", onClick: () => { setMenuOpen(false); run(() => plugin.stop()); } },
            h("span", null, "Stop playback"), icon("close", 14)),
          h("button", { className: "yp-menu-item", onClick: () => { setMenuOpen(false); clearQueue(); } },
            h("span", null, "Clear queue"), icon("trash", 14)))
      : null,
    view === "search"
      ? searchNode
      : view === "queue"
        ? queueNode
        : view === "settings"
          ? settingsNode
          : nowNode,
    botMenuNode
  );
}

function startResize(e, plugin) {
  e.preventDefault();
  plugin.settings.fullHeight = false;
  const startY = e.clientY;
  const startH = Number(plugin.settings.height) || 330;
  const move = (ev) => {
    plugin.settings.height = Math.max(180, Math.min(560, startH + (startY - ev.clientY)));
    plugin.save();
    plugin._bump?.();
  };
  const up = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

module.exports = YouTubePanel;
