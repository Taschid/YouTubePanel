/**
 * @name YouTubePanel
 * @description Standalone YouTube / YouTube Music controller for Discord with stream extraction and embed fallback. No sidecar, mpv, or yt-dlp.
 * @version 0.3.0
 * @author jcode
 * @authorId 0
 */

const PLUGIN = "YouTubePanel";
const { React } = BdApi;
const h = React.createElement;
const { useState, useEffect, useRef, useReducer } = React;

const DEFAULT_SETTINGS = {
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
  audioSource: "auto",
};

const AUDIO_SOURCES = [
  { id: "auto", label: "Auto (stream, then embed)" },
  { id: "stream", label: "Stream extraction" },
  { id: "embed", label: "YouTube embed" },
];

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

// ------------------------------------------------------------ youtube local
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YT_INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const YT_VISIONOS_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const YT_VISIONOS_CONTEXT = {
  clientName: "VISIONOS",
  clientVersion: "1.02",
  deviceMake: "Apple",
  deviceModel: "RealityDevice17,1",
  userAgent: YT_VISIONOS_UA,
  osName: "visionOS",
  osVersion: "26.5.23O471",
  hl: "en",
  gl: "US",
};
let visitorCache = { value: "", at: 0 };

function canonicalWatchUrl(id) {
  return "https://www.youtube.com/watch?v=" + id;
}

function videoIdFromUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (YT_ID_RE.test(raw)) return raw;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : "https://" + raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0] || "";
      return YT_ID_RE.test(id) ? id : "";
    }
    if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtube-nocookie.com") {
      const v = url.searchParams.get("v") || "";
      if (YT_ID_RE.test(v)) return v;
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 2 && ["embed", "shorts", "live", "v"].includes(parts[0]) && YT_ID_RE.test(parts[1])) {
        return parts[1];
      }
    }
  } catch {}
  const match = raw.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?[^#]*v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/);
  return match ? match[1] : "";
}

function parseYouTubeDuration(text) {
  const parts = String(text || "").trim().split(":").map((part) => Number(part));
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function youTubeText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node.simpleText === "string") return node.simpleText;
  if (Array.isArray(node.runs)) return node.runs.map((run) => run?.text || "").join("");
  return "";
}

function jsonObjectAfter(text, marker) {
  const markerAt = text.indexOf(marker);
  if (markerAt < 0) return null;
  const start = text.indexOf("{", markerAt);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function extractYouTubeInitialData(html) {
  const markers = ["var ytInitialData", "ytInitialData =", 'window["ytInitialData"]', "ytInitialData"];
  for (const marker of markers) {
    const raw = jsonObjectAfter(html, marker);
    if (!raw) continue;
    try { return JSON.parse(raw); } catch {}
  }
  return null;
}

function walkYouTubeObjects(root, key, out = []) {
  if (!root || typeof root !== "object") return out;
  if (root[key]) out.push(root[key]);
  for (const child of Object.keys(root)) {
    if (child === key) continue;
    walkYouTubeObjects(root[child], key, out);
  }
  return out;
}

function normalizeYouTubeVideo(renderer) {
  if (!renderer || !YT_ID_RE.test(String(renderer.videoId || ""))) return null;
  const id = renderer.videoId;
  const title = youTubeText(renderer.title) || youTubeText(renderer.headline) || "Untitled";
  const rawArtist = youTubeText(renderer.ownerText)
    || youTubeText(renderer.longBylineText)
    || youTubeText(renderer.shortBylineText)
    || "YouTube";
  const thumbs = renderer.thumbnail?.thumbnails || [];
  const thumbnail = thumbs.length
    ? thumbs[thumbs.length - 1].url
    : "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
  return {
    id,
    title: String(title).trim() || "Untitled",
    artist: String(rawArtist).replace(/\s*-\s*Topic$/i, "").trim() || "YouTube",
    duration: parseYouTubeDuration(youTubeText(renderer.lengthText)),
    thumbnail,
    url: canonicalWatchUrl(id),
  };
}

function parseYouTubeSearchData(data) {
  const renderers = walkYouTubeObjects(data, "videoRenderer");
  const seen = new Set();
  const items = [];
  for (const renderer of renderers) {
    const track = normalizeYouTubeVideo(renderer);
    if (!track || seen.has(track.id)) continue;
    seen.add(track.id);
    items.push(track);
    if (items.length >= 20) break;
  }
  return items;
}

function bdNetFetch() {
  try {
    if (typeof BdApi !== "undefined" && BdApi.Net && typeof BdApi.Net.fetch === "function") {
      return BdApi.Net.fetch.bind(BdApi.Net);
    }
  } catch {}
  return typeof fetch === "function" ? fetch.bind(globalThis) : null;
}

async function netFetchText(url, headers = {}, options = {}) {
  const fetcher = bdNetFetch();
  if (!fetcher) throw new Error("network is unavailable");
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), options.timeout || 15000) : 0;
  try {
    const init = {
      ...options,
      headers: { "Accept-Language": "en-US,en;q=0.9", ...headers },
      ...(controller ? { signal: controller.signal } : {}),
    };
    const res = await fetcher(url, init);
    if (!res || !res.ok) throw new Error("YouTube HTTP " + (res?.status || "?"));
    return await res.text();
  } catch (e) {
    if (e?.name === "AbortError") throw new Error("YouTube request timed out");
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function netFetchBuffer(url, headers = {}, options = {}) {
  const fetcher = bdNetFetch();
  if (!fetcher) throw new Error("network is unavailable");
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), options.timeout || 30000) : 0;
  try {
    const init = {
      ...options,
      headers: { Accept: "*/*", ...headers },
      ...(controller ? { signal: controller.signal } : {}),
    };
    const res = await fetcher(url, init);
    if (!res || !res.ok) throw new Error("audio HTTP " + (res?.status || "?"));
    if (typeof res.arrayBuffer === "function") return await res.arrayBuffer();
    if (typeof res.blob === "function") return await (await res.blob()).arrayBuffer();
    throw new Error("audio response has no binary reader");
  } catch (e) {
    if (e?.name === "AbortError") throw new Error("audio request timed out");
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getYouTubeVisitorData(id) {
  if (visitorCache.value && Date.now() - visitorCache.at < 30 * 60 * 1000) return visitorCache.value;
  const html = await netFetchText(
    "https://www.youtube.com/watch?v=" + encodeURIComponent(id) + "&hl=en",
    { "Accept-Language": "en-US,en;q=0.9" }
  );
  const match = html.match(/visitorData":"([^"]+)"/);
  if (!match) throw new Error("YouTube did not provide visitorData");
  visitorCache = { value: match[1], at: Date.now() };
  return match[1];
}

async function resolveAudioStream(id) {
  const videoId = videoIdFromUrl(id);
  if (!videoId) throw new Error("not a YouTube video URL or id");
  const visitorData = await getYouTubeVisitorData(videoId);
  const payload = {
    context: { client: { ...YT_VISIONOS_CONTEXT, visitorData } },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  };
  const text = await netFetchText(
    "https://www.youtube.com/youtubei/v1/player?key=" + YT_INNERTUBE_KEY,
    {
      "Content-Type": "application/json",
      "User-Agent": YT_VISIONOS_UA,
      "X-Goog-Visitor-Id": visitorData,
      "X-Goog-Api-Format-Version": "2",
    },
    { method: "POST", body: JSON.stringify(payload) }
  );
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("YouTube player returned invalid JSON"); }
  const status = data?.playabilityStatus?.status;
  if (status !== "OK") {
    if (status === "LOGIN_REQUIRED") visitorCache = { value: "", at: 0 };
    throw new Error("YouTube stream " + (status || "failed") + ": " + (data?.playabilityStatus?.reason || "unavailable"));
  }
  const formats = Array.isArray(data?.streamingData?.adaptiveFormats) ? data.streamingData.adaptiveFormats : [];
  const audio = formats.filter((format) => String(format?.mimeType || "").startsWith("audio/") && format?.url);
  const chosen = audio.find((format) => Number(format.itag) === 140)
    || audio.find((format) => Number(format.itag) === 251)
    || audio.find((format) => Number(format.itag) === 139)
    || audio[0];
  if (!chosen) throw new Error("YouTube did not return an audio stream");
  return {
    url: chosen.url,
    mimeType: chosen.mimeType || "audio/mp4",
    contentLength: Number(chosen.contentLength) || 0,
    itag: Number(chosen.itag) || 0,
  };
}

async function searchYouTube(query) {
  const q = String(query || "").trim();
  if (!q) return { items: [] };
  const url = "https://www.youtube.com/results?search_query=" + encodeURIComponent(q) + "&hl=en&gl=US";
  const html = await netFetchText(url);
  const data = extractYouTubeInitialData(html);
  if (!data) throw new Error("YouTube returned a consent or captcha page. Paste a video URL instead.");
  const items = parseYouTubeSearchData(data);
  if (!items.length) throw new Error("No YouTube results. Paste a video URL instead.");
  return { items };
}

async function resolveYouTubeTrack(input) {
  const id = videoIdFromUrl(input);
  if (!id) throw new Error("not a YouTube video URL or id");
  let meta = {};
  try {
    const text = await netFetchText("https://www.youtube.com/oembed?url=" + encodeURIComponent(canonicalWatchUrl(id)) + "&format=json");
    meta = JSON.parse(text);
  } catch {}
  return {
    id,
    title: meta.title || ("YouTube video " + id),
    artist: String(meta.author_name || "YouTube").replace(/\s*-\s*Topic$/i, "").trim() || "YouTube",
    duration: 0,
    thumbnail: meta.thumbnail_url || ("https://i.ytimg.com/vi/" + id + "/hqdefault.jpg"),
    url: canonicalWatchUrl(id),
  };
}

class LocalQueue {
  constructor() {
    this.items = [];
    this.index = -1;
    this.repeat = "off";
    this.shuffle = false;
  }

  current() {
    return this.items[this.index] || null;
  }

  replace(track) {
    this.items = track ? [track] : [];
    this.index = track ? 0 : -1;
  }

  add(track) {
    if (!track) return;
    this.items.push(track);
    if (this.index < 0) this.index = 0;
  }

  select(index) {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= this.items.length) return null;
    this.index = i;
    return this.current();
  }

  remove(index) {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= this.items.length) return null;
    const removed = this.items.splice(i, 1)[0] || null;
    if (!this.items.length) this.index = -1;
    else if (i < this.index) this.index--;
    else if (i === this.index) this.index = Math.min(this.index, this.items.length - 1);
    return removed;
  }

  next(auto = false) {
    if (!this.items.length) return null;
    if (auto && this.repeat === "one") return this.current();
    if (this.index + 1 < this.items.length) {
      this.index++;
      return this.current();
    }
    if (this.repeat === "all") {
      this.index = 0;
      return this.current();
    }
    return null;
  }

  previous() {
    if (!this.items.length) return null;
    if (this.index > 0) {
      this.index--;
      return this.current();
    }
    if (this.repeat === "all") {
      this.index = this.items.length - 1;
      return this.current();
    }
    return null;
  }

  shuffleUpcoming() {
    this.shuffle = !this.shuffle;
    if (!this.items.length) return;
    const current = this.current();
    const rest = this.items.filter((_, i) => i !== this.index);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    this.items = current ? [current, ...rest] : rest;
    this.index = current ? 0 : (this.items.length ? 0 : -1);
  }

  clear() {
    this.items = [];
    this.index = -1;
  }
}

class YouTubeEngine {
  constructor(plugin) {
    this.plugin = plugin;
    this.queue = new LocalQueue();
    this.track = null;
    this.isPlaying = false;
    this.position = 0;
    this.duration = 0;
    this.volume = Math.max(0, Math.min(100, Number(plugin.settings.volume) || 70));
    this.blocked = false;
    this.videoVisible = false;
    this.error = "";
    this.mode = "none";
    this.loading = false;
    this.streamError = "";
    this._iframe = null;
    this._host = null;
    this._audio = null;
    this._audioUrl = "";
    this._streamToken = 0;
    this._listener = null;
    this._loadTimer = 0;
    this._listenTimer = 0;
    this._autoplayTimer = 0;
    this._muteTimer = 0;
    this._notifyTimer = 0;
    this._volumeSent = false;
    this._ending = false;
    this._playerId = Math.floor(Math.random() * 1000000) + 1;
    this._ready = false;
    this._started = false;
    this._muted = false;
    this._gotInfo = false;
  }

  start() {
    if (this._listener) return;
    this._listener = (event) => this.onMessage(event);
    window.addEventListener("message", this._listener);
  }

  destroy() {
    try { if (this._listener) window.removeEventListener("message", this._listener); } catch {}
    this._listener = null;
    clearTimeout(this._loadTimer);
    clearInterval(this._listenTimer);
    clearTimeout(this._autoplayTimer);
    clearTimeout(this._muteTimer);
    clearTimeout(this._notifyTimer);
    this._loadTimer = 0;
    this._listenTimer = 0;
    this._autoplayTimer = 0;
    this._muteTimer = 0;
    this._notifyTimer = 0;
    this._streamToken++;
    this.mode = "none";
    this.clearAudio();
    try { this._iframe?.remove(); } catch {}
    try { this._host?.remove(); } catch {}
    try { this._audio?.remove(); } catch {}
    this._iframe = null;
    this._host = null;
    this._audio = null;
    this.videoVisible = false;
  }

  ensureHost() {
    if (this._host && document.body.contains(this._host)) return this._host;
    try { document.querySelectorAll("#youtubepanel-audio-host").forEach((el) => el.remove()); } catch {}
    const host = document.createElement("div");
    host.id = "youtubepanel-audio-host";
    host.style.cssText = "position:fixed;left:0;bottom:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:0;";
    document.body.appendChild(host);
    this._host = host;
    return host;
  }

  ensureIframe() {
    if (this._iframe && this._iframe.isConnected) return this._iframe;
    const host = this.ensureHost();
    const iframe = document.createElement("iframe");
    iframe.id = "youtubepanel-player";
    iframe.title = "YouTube player";
    iframe.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
    iframe.setAttribute("allowfullscreen", "true");
    iframe.style.cssText = "width:100%;height:100%;border:0;background:#000;";
    iframe.addEventListener("load", () => this.beginListening());
    host.appendChild(iframe);
    this._iframe = iframe;
    return iframe;
  }

  post(func, args = []) {
    try {
      this._iframe?.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func, args, id: this._playerId, channel: "widget" }),
        "https://www.youtube.com"
      );
    } catch {}
  }

  beginListening() {
    clearInterval(this._listenTimer);
    const listen = () => {
      if (this._ready || !this._iframe?.contentWindow) return;
      try {
        this._iframe.contentWindow.postMessage(
          JSON.stringify({ event: "listening", id: this._playerId, channel: "widget" }),
          "https://www.youtube.com"
        );
      } catch {}
    };
    listen();
    this._listenTimer = setInterval(listen, 250);
  }

  notify() {
    if (this._notifyTimer) return;
    this._notifyTimer = setTimeout(() => {
      this._notifyTimer = 0;
      this.plugin._bump?.();
    }, 120);
  }

  snapshot() {
    return {
      track: this.track,
      isPlaying: this.isPlaying,
      position: this.position,
      duration: this.duration,
      volume: this.volume,
      shuffle: this.queue.shuffle,
      repeat: this.queue.repeat,
      blocked: this.blocked,
      muted: this._muted,
      gotInfo: this._gotInfo,
      mode: this.mode,
      loading: this.loading,
      streamError: this.streamError,
      videoVisible: this.videoVisible,
      error: this.error,
      queue: {
        items: this.queue.items.slice(),
        index: this.queue.index,
        upcoming: this.queue.index >= 0 ? this.queue.items.slice(this.queue.index + 1) : [],
      },
    };
  }

  setVideoVisible(visible) {
    this.videoVisible = !!visible;
    if (!this._host) {
      this.notify();
      return;
    }
    if (this.videoVisible) {
      this.post("unMute");
      this.post("setVolume", [this.volume]);
      this._host.style.cssText = "position:fixed;right:16px;bottom:16px;width:320px;height:180px;overflow:hidden;opacity:1;pointer-events:auto;z-index:9999;box-shadow:0 8px 28px rgba(0,0,0,0.65);border:1px solid rgba(255,255,255,0.15);";
    } else {
      this._host.style.cssText = "position:fixed;left:0;bottom:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:0;";
    }
    this.notify();
  }

  unmuteNow() {
    if (this.mode === "stream") {
      try {
        this._audio.muted = false;
        this._audio.volume = this.volume / 100;
        const played = this._audio.play();
        if (played && typeof played.catch === "function") {
          played.catch(() => { this.blocked = true; this.notify(); });
        }
      } catch {}
      this.blocked = false;
      this.notify();
      return;
    }
    this.post("unMute");
    this.post("setVolume", [this.volume]);
    this.blocked = false;
    this.notify();
  }

  enableSound() {
    if (this.mode === "stream") {
      this.unmuteNow();
      return;
    }
    this.unmuteNow();
    clearTimeout(this._muteTimer);
    this._muteTimer = setTimeout(() => {
      if (!this._muted) return;
      this.setVideoVisible(true);
      this.blocked = true;
      this.notify();
    }, 1200);
  }

  ensureAudio() {
    if (this._audio) return this._audio;
    const audio = document.createElement("audio");
    audio.preload = "auto";
    audio.style.cssText = "display:none;";
    audio.addEventListener("loadedmetadata", () => {
      if (this.mode !== "stream") return;
      if (Number.isFinite(audio.duration) && audio.duration > 0) this.duration = audio.duration;
      this.notify();
    });
    audio.addEventListener("timeupdate", () => {
      if (this.mode !== "stream") return;
      this.position = Number(audio.currentTime) || 0;
      if (Number.isFinite(audio.duration) && audio.duration > 0) this.duration = audio.duration;
      this.notify();
    });
    audio.addEventListener("play", () => {
      if (this.mode !== "stream") return;
      this.isPlaying = true;
      this.blocked = false;
      this.notify();
    });
    audio.addEventListener("pause", () => {
      if (this.mode !== "stream" || audio.ended) return;
      this.isPlaying = false;
      this.notify();
    });
    audio.addEventListener("ended", () => {
      if (this.mode !== "stream") return;
      this.isPlaying = false;
      this.handleEnded();
    });
    audio.addEventListener("error", () => {
      if (this.mode !== "stream") return;
      this.error = "Audio stream failed.";
      this.isPlaying = false;
      this.notify();
    });
    document.body.appendChild(audio);
    this._audio = audio;
    return audio;
  }

  clearAudio() {
    if (this._audio) {
      try { this._audio.pause(); } catch {}
      try { this._audio.removeAttribute("src"); } catch {}
      try { this._audio.load(); } catch {}
    }
    if (this._audioUrl) {
      try { URL.revokeObjectURL(this._audioUrl); } catch {}
      this._audioUrl = "";
    }
  }

  async startStream(track, token) {
    this.mode = "loading";
    this.loading = true;
    this.streamError = "";
    this.notify();
    try {
      const stream = await resolveAudioStream(track.id);
      if (token !== this._streamToken) return;
      const buffer = await netFetchBuffer(stream.url, { "User-Agent": YT_VISIONOS_UA });
      if (token !== this._streamToken) return;
      const blob = new Blob([buffer], { type: stream.mimeType });
      const audioUrl = URL.createObjectURL(blob);
      this.clearAudio();
      this._audioUrl = audioUrl;
      const audio = this.ensureAudio();
      audio.src = audioUrl;
      audio.volume = this.volume / 100;
      audio.muted = false;
      this.mode = "stream";
      this.loading = false;
      this.isPlaying = true;
      this.blocked = false;
      this.error = "";
      this.notify();
      const played = audio.play();
      if (played && typeof played.catch === "function") {
        played.catch(() => {
          this.blocked = true;
          this.notify();
        });
      }
    } catch (e) {
      if (token !== this._streamToken) return;
      this.loading = false;
      this.streamError = e?.message || "stream extraction failed";
      this.mode = "none";
      this.notify();
      this.loadEmbed(track);
    }
  }

  load(track) {
    if (!track?.id) throw new Error("not a playable YouTube track");
    this.track = track;
    this.position = 0;
    this.duration = Number(track.duration) || 0;
    this.isPlaying = true;
    this.blocked = false;
    this.error = "";
    this.streamError = "";
    this.loading = false;
    this.mode = "none";
    this._muted = false;
    this._gotInfo = false;
    this._streamToken++;
    this.videoVisible = false;
    if (this._host) {
      this._host.style.cssText = "position:fixed;left:0;bottom:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:0;";
    }
    this.clearAudio();
    if (this._iframe) {
      try { this._iframe.src = "about:blank"; } catch {}
    }
    const source = String(this.plugin.settings.audioSource || "auto");
    if (source === "embed") {
      this.loadEmbed(track);
      return;
    }
    this.startStream(track, this._streamToken);
  }

  loadEmbed(track) {
    if (!track?.id) throw new Error("not a playable YouTube track");
    this.track = track;
    this.position = 0;
    this.duration = Number(track.duration) || 0;
    this.isPlaying = true;
    this.blocked = false;
    this.error = "";
    this._volumeSent = false;
    this._ready = false;
    this._started = false;
    this._muted = true;
    this._gotInfo = false;
    this._ending = false;
    this.mode = "embed";
    this.loading = false;
    clearTimeout(this._loadTimer);
    clearTimeout(this._autoplayTimer);
    clearTimeout(this._muteTimer);
    this._muteTimer = 0;
    const iframe = this.ensureIframe();
    const origin = (typeof location !== "undefined" && location.origin && location.origin !== "null")
      ? location.origin
      : "";
    const params = new URLSearchParams({
      autoplay: "1",
      enablejsapi: "1",
      playsinline: "1",
      rel: "0",
      hl: "en",
      mute: "1",
      ...(origin ? { origin, widget_referrer: location.href } : {}),
    });
    iframe.src = "https://www.youtube.com/embed/" + encodeURIComponent(track.id) + "?" + params.toString();
    this.beginListening();
    this._loadTimer = setTimeout(() => {
      if (this._volumeSent) return;
      clearInterval(this._listenTimer);
      this._listenTimer = 0;
      this.blocked = true;
      this.notify();
    }, 4500);
    this._autoplayTimer = setTimeout(() => {
      if (this._started || this.error || !this.track) return;
      this.blocked = true;
      this.notify();
    }, 4500);
    this.notify();
  }

  onMessage(event) {
    if (!this._iframe || event.source !== this._iframe.contentWindow) return;
    if (event.origin !== "https://www.youtube.com") return;
    if (this.mode !== "embed") return;
    let data = event.data;
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch { return; }
    }
    if (!data) return;
    if (data.event === "onError") {
      const code = Number(data.info);
      clearTimeout(this._loadTimer);
      clearInterval(this._listenTimer);
      clearTimeout(this._autoplayTimer);
      clearTimeout(this._muteTimer);
      this._loadTimer = 0;
      this._listenTimer = 0;
      this._autoplayTimer = 0;
      this._muteTimer = 0;
      this.isPlaying = false;
      this.blocked = false;
      this._muted = false;
      this.error = (code === 101 || code === 150)
        ? "The video owner does not allow embedded playback. Use Open on YouTube."
        : "YouTube player error " + (Number.isFinite(code) ? code : "unknown") + ".";
      this.notify();
      return;
    }
    if (data.event === "initialDelivery") {
      this._ready = true;
      clearInterval(this._listenTimer);
      this._listenTimer = 0;
    } else if (data.event === "infoDelivery") {
      this._ready = true;
      clearInterval(this._listenTimer);
      this._listenTimer = 0;
    } else if (data.event === "onReady" || data.event === "alreadyInitialized") {
      this._ready = true;
      clearInterval(this._listenTimer);
      this._listenTimer = 0;
    } else {
      return;
    }
    const hasInfo = data.event === "initialDelivery" || data.event === "infoDelivery";
    if (!hasInfo) {
      this.notify();
      return;
    }
    this._gotInfo = true;
    const info = data.info || {};
    if (typeof info.muted === "boolean") {
      this._muted = info.muted;
      if (!info.muted) {
        clearTimeout(this._muteTimer);
        this._muteTimer = 0;
        this.blocked = false;
      }
    }
    if (info.videoData && info.videoData.isPlayable === false) {
      clearTimeout(this._loadTimer);
      clearInterval(this._listenTimer);
      clearTimeout(this._autoplayTimer);
      clearTimeout(this._muteTimer);
      this._loadTimer = 0;
      this._listenTimer = 0;
      this._autoplayTimer = 0;
      this._muteTimer = 0;
      this.isPlaying = false;
      this.error = "YouTube cannot play this video here. Use Open on YouTube.";
      this.notify();
      return;
    }
    if (typeof info.currentTime === "number" && Number.isFinite(info.currentTime)) this.position = info.currentTime;
    if (typeof info.duration === "number" && Number.isFinite(info.duration) && info.duration > 0) this.duration = info.duration;
    if (typeof info.playerState === "number") {
      if (info.playerState === 1 || info.playerState === 3) {
        this._started = true;
        clearTimeout(this._autoplayTimer);
        this._autoplayTimer = 0;
      }
      if (info.playerState === 1) {
        this.isPlaying = true;
        this.blocked = false;
      } else if (info.playerState === 2) {
        this.isPlaying = false;
      } else if (info.playerState === 0) {
        this.isPlaying = false;
        if (!this._ending) {
          this._ending = true;
          setTimeout(() => this.handleEnded(), 0);
        }
      }
    }
    if (!this._volumeSent) {
      this._volumeSent = true;
      clearTimeout(this._loadTimer);
      this._loadTimer = 0;
      this.blocked = false;
      this.post("unMute");
      this.post("setVolume", [this.volume]);
      clearTimeout(this._muteTimer);
      this._muteTimer = setTimeout(() => {
        if (this._muted) {
          this.blocked = true;
          this.notify();
        }
      }, 2000);
    }
    this.notify();
  }

  handleEnded() {
    this._ending = false;
    if (!this.track) return;
    if (this.queue.repeat === "one") {
      this.position = 0;
      if (this.mode === "stream") {
        this.seek(0);
        this.resume();
      } else {
        this.post("seekTo", [0, true]);
        this.post("playVideo");
      }
      this.isPlaying = true;
      this.notify();
      return;
    }
    const next = this.queue.next(true);
    if (next && next.id !== this.track.id) {
      this.load(next);
    } else if (next) {
      this.position = 0;
      if (this.mode === "stream") {
        this.seek(0);
        this.resume();
      } else {
        this.post("seekTo", [0, true]);
        this.post("playVideo");
      }
      this.isPlaying = true;
      this.notify();
    } else {
      this.isPlaying = false;
      this.position = this.duration;
      this.notify();
    }
  }

  async play(input) {
    const source = input?.url || input;
    const id = input?.id || videoIdFromUrl(source);
    if (!id) throw new Error("not a YouTube video URL or id");
    if (input?.id) {
      this.queue.replace(input);
      this.load(input);
      return this.snapshot();
    }
    // Load the iframe inside the click gesture; resolve title/artist afterward.
    const placeholder = {
      id,
      title: "Loading YouTube video...",
      artist: "YouTube",
      duration: 0,
      thumbnail: "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg",
      url: canonicalWatchUrl(id),
    };
    this.queue.replace(placeholder);
    this.load(placeholder);
    resolveYouTubeTrack(id).then((track) => {
      if (this.track?.id !== id) return;
      this.track = track;
      if (this.queue.items[this.queue.index]?.id === id) this.queue.items[this.queue.index] = track;
      if (!this.duration && track.duration) this.duration = track.duration;
      this.notify();
    }).catch(() => {
      if (this.track?.id !== id || this.track.title !== "Loading YouTube video...") return;
      const fallback = { ...placeholder, title: "YouTube video " + id };
      this.track = fallback;
      if (this.queue.items[this.queue.index]?.id === id) this.queue.items[this.queue.index] = fallback;
      this.notify();
    });
    return this.snapshot();
  }

  async add(input) {
    const track = input && input.id ? input : await resolveYouTubeTrack(input?.url || input);
    this.queue.add(track);
    if (!this.track) this.load(track);
    else this.notify();
    return this.snapshot();
  }

  pause() {
    if (this.mode === "stream") {
      try { this._audio.pause(); } catch {}
    } else {
      this.post("pauseVideo");
    }
    clearTimeout(this._autoplayTimer);
    this._autoplayTimer = 0;
    this.blocked = false;
    this.isPlaying = false;
    this.notify();
    return this.snapshot();
  }

  resume() {
    if (!this.track) return this.snapshot();
    if (this.mode === "stream") {
      try {
        const played = this._audio.play();
        if (played && typeof played.catch === "function") {
          played.catch(() => {
            this.blocked = true;
            this.notify();
          });
        }
      } catch {}
      this.blocked = false;
      this.notify();
      return this.snapshot();
    }
    if (!this._volumeSent) this.load(this.track);
    else {
      this.post("playVideo");
      this.isPlaying = true;
    }
    this.blocked = false;
    this.notify();
    return this.snapshot();
  }

  seek(seconds) {
    const value = Math.max(0, Math.min(Number(seconds) || 0, this.duration || Number(seconds) || 0));
    this.position = value;
    if (this.mode === "stream") {
      try { this._audio.currentTime = value; } catch {}
    } else {
      this.post("seekTo", [value, true]);
    }
    this.notify();
    return this.snapshot();
  }

  setVolume(percent) {
    const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    this.volume = value;
    if (this.mode === "stream") {
      try { this._audio.volume = value / 100; } catch {}
    } else {
      this.post("setVolume", [value]);
    }
    this.notify();
    return this.snapshot();
  }

  stop() {
    this._streamToken++;
    this.loading = false;
    if (this.mode === "loading") this.mode = "none";
    if (this.mode === "stream") {
      try { this._audio.pause(); this._audio.currentTime = 0; } catch {}
    } else {
      this.post("stopVideo");
    }
    clearTimeout(this._autoplayTimer);
    clearTimeout(this._muteTimer);
    this._autoplayTimer = 0;
    this._muteTimer = 0;
    this._started = false;
    this._muted = false;
    this.isPlaying = false;
    this.position = 0;
    this._volumeSent = false;
    this.notify();
    return this.snapshot();
  }

  clearQueue() {
    this._streamToken++;
    this.clearAudio();
    this.mode = "none";
    this.loading = false;
    clearTimeout(this._autoplayTimer);
    clearTimeout(this._muteTimer);
    this._autoplayTimer = 0;
    this._muteTimer = 0;
    this._started = false;
    this._muted = false;
    this.error = "";
    this.blocked = false;
    this.videoVisible = false;
    if (this._host) {
      this._host.style.cssText = "position:fixed;left:0;bottom:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:0;";
    }
    this.queue.clear();
    this.track = null;
    this.isPlaying = false;
    this.position = 0;
    this.duration = 0;
    this._volumeSent = false;
    if (this._iframe) this._iframe.src = "about:blank";
    this.notify();
    return this.snapshot();
  }

  next() {
    const next = this.queue.next(false);
    if (next) this.load(next);
    else this.stop();
    return this.snapshot();
  }

  previous() {
    if (this.position > 3) {
      this.seek(0);
      return this.snapshot();
    }
    const prev = this.queue.previous();
    if (prev) this.load(prev);
    else this.seek(0);
    return this.snapshot();
  }

  jump(index) {
    const track = this.queue.select(index);
    if (track) this.load(track);
    return this.snapshot();
  }

  remove(index) {
    const removed = this.queue.remove(index);
    if (removed && removed.id === this.track?.id) {
      const current = this.queue.current();
      if (current) this.load(current);
      else this.clearQueue();
    } else {
      this.notify();
    }
    return this.snapshot();
  }

  repeat(state) {
    if (state) this.queue.repeat = state;
    else this.queue.repeat = this.queue.repeat === "off" ? "all" : (this.queue.repeat === "all" ? "one" : "off");
    this.notify();
    return this.snapshot();
  }

  shuffle() {
    this.queue.shuffleUpcoming();
    this.notify();
    return this.snapshot();
  }
}

// ------------------------------------------------------------------- plugin
class YouTubePanel {
  constructor(meta) {
    this.meta = meta;
    this.bd = typeof BdApi === "function" ? new BdApi(PLUGIN) : BdApi;
    this.settings = { ...DEFAULT_SETTINGS, ...(this.bd.Data.load("settings") || {}) };
    // v0.1.1: move the previous Alt+Y default to Alt+Q. A custom binding is
    // left alone unless it is exactly the old default.
    let dirty = false;
    const hk = Array.isArray(this.settings.hotkey) ? this.settings.hotkey : [];
    if (hk.length === 2 && String(hk[0]).toLowerCase() === "alt" && String(hk[1]).toLowerCase() === "y") {
      this.settings.hotkey = ["Alt", "q"];
      dirty = true;
    }
    for (const key of ["sidecarUrl", "sidecarToken"]) {
      if (Object.prototype.hasOwnProperty.call(this.settings, key)) {
        delete this.settings[key];
        dirty = true;
      }
    }
    if (dirty) this.save();
    this.engine = new YouTubeEngine(this);
    this._searchCache = new Map();
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

  // ------------------------------------------------------- local playback
  state() { return this.engine.snapshot(); }
  search(q) {
    const key = String(q || "").trim().toLowerCase();
    const cached = this._searchCache.get(key);
    if (cached && Date.now() - cached.at < 120000) return Promise.resolve(cached.value);
    return searchYouTube(q).then((value) => {
      this._searchCache.set(key, { at: Date.now(), value });
      if (this._searchCache.size > 20) {
        const oldest = this._searchCache.keys().next().value;
        this._searchCache.delete(oldest);
      }
      return value;
    });
  }
  play(input) { return this.engine.play(input); }
  addQueue(input) { return this.engine.add(input); }
  removeQueue(index) { return this.engine.remove(index); }
  jump(index) { return this.engine.jump(index); }
  pause() { return this.engine.pause(); }
  resume() { return this.engine.resume(); }
  next() { return this.engine.next(); }
  previous() { return this.engine.previous(); }
  seek(seconds) { return this.engine.seek(seconds); }
  setVolume(percent) { return this.engine.setVolume(percent); }
  shuffle() { return this.engine.shuffle(); }
  repeat(state) { return this.engine.repeat(state); }
  stop() { return this.engine.stop(); }
  clearQueue() { return this.engine.clearQueue(); }

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
    this.engine.start();
    if (this.settings.visible) this.hideOtherPanels();
    this.mount();
    this.log("started; visible=" + this.settings.visible);
  }

  stop() {
    this.unregisterPanel();
    try { BdApi.DOM.removeStyle("YouTubePanel-css"); } catch {}
    this.stopHotkey();
    this.engine.destroy();
    this.unmount();
    this.log("stopped");
  }

  getSettingsPanel() {
    return this.bd.UI.buildSettingsPanel({
      settings: [
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
          type: "dropdown",
          id: "audioSource",
          name: "Audio source",
          note: "Stream extraction also plays label-blocked videos. Embed is the official player.",
          value: AUDIO_SOURCES.some((source) => source.id === this.settings.audioSource) ? this.settings.audioSource : "auto",
          options: AUDIO_SOURCES.map((source) => ({ label: source.label, value: source.id })),
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
        } else if (id === "audioSource") {
          this.settings.audioSource = AUDIO_SOURCES.some((source) => source.id === value) ? value : "auto";
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
  const [error, setError] = useState(null);
  const [engineError, setEngineError] = useState(null);
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
      setEngineError(next.error || null);
    } catch (e) {
      setEngineError(e?.message || "player error");
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
        setEngineError(next.error || null);
      } catch (e) {
        if (!alive) return;
        setEngineError(e?.message || "player error");
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
        plugin.setVolume(saved);
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
    setError(null);
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
    volTimer.current = setTimeout(() => { plugin.setVolume(next); }, 160);
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
    await run(() => plugin.play(t));
    setView("now");
  };

  const addQueue = async (t) => {
    if (!t?.url) return;
    await run(() => plugin.addQueue(t));
    flashNotice("added to queue");
  };

  const playUrl = async () => {
    const url = urlDraft.trim();
    if (!url) { flashNotice("paste a YouTube URL"); return; }
    await run(() => plugin.play({ url }));
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

  const saveChannel = () => {
    plugin.settings.musicChannelId = channelDraft.trim();
    plugin.save();
    flashNotice("music channel saved", 3000);
  };

  // ---------------------------------------------------------------- views
  const miniBar = h("div", {
    className: "yp-mini",
    title: "Back to player",
    onClick: () => setView("now"),
  },
    cover ? h("img", { src: cover, alt: "" }) : h("div", { className: "yp-mini-art" }),
    h("div", { className: "yp-mini-main" },
      h("div", { className: "yp-mini-title" }, track ? track.title : "Nothing playing"),
      h("div", { className: "yp-mini-sub" }, track ? (track.artist || "YouTube") : "search or paste a YouTube link")),
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
      h("div", { className: "yp-artist" }, track ? (track.artist || "YouTube") : "Search or paste a YouTube link"),
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
    state?.blocked
      ? h("div", { className: "yp-error" },
          state?.mode === "stream"
            ? "Audio did not start. "
            : (state?.muted && state?.gotInfo)
              ? "YouTube started muted. "
              : "YouTube did not start. This video may be blocked from embeds. ",
          (state?.mode === "stream" || (state?.muted && state?.gotInfo)) ? h("button", {
            className: "yp-textbtn",
            onClick: () => plugin.engine.enableSound(),
          }, "Enable sound") : null,
          track ? h("button", {
            className: "yp-textbtn",
            onClick: async () => { await sendBotCommand("play"); },
          }, "Send to bot") : null,
          state?.mode !== "stream" ? h("button", {
            className: "yp-textbtn",
            onClick: () => plugin.engine.setVideoVisible(!state.videoVisible),
          }, state.videoVisible ? "Hide video" : "Show video") : null,
          track ? h("button", {
            className: "yp-textbtn",
            onClick: () => openExternal(track.url),
          }, "Open on YouTube") : null)
      : null,
    state?.loading ? h("div", { className: "yp-notice" }, "Loading audio stream...") : null,
    notice ? h("div", { className: "yp-notice" }, notice) : null,
    (error || engineError) ? h("div", { className: "yp-error" },
      error || engineError,
      track ? h("button", {
        className: "yp-textbtn",
        onClick: async () => { await sendBotCommand("play"); },
      }, "Send to bot") : null,
      track ? h("button", {
        className: "yp-textbtn",
        onClick: () => openExternal(track.url),
      }, "Open on YouTube") : null) : null,
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
        placeholder: "Paste a YouTube URL",
        value: urlDraft,
        onChange: (e) => setUrlDraft(e.target.value),
        onKeyDown: (e) => { if (e.key === "Enter") playUrl(); },
      }),
      h("button", { className: "yp-textbtn", onClick: playUrl }, "Play URL")),
    h("div", { className: "yp-scroll" },
      results === null
        ? h("div", { className: "yp-empty" }, "Search YouTube or paste a URL above.")
        : results.length
          ? results.map((t) => row(t, t.id || t.url, () => playTrack(t), addQueue))
          : h("div", { className: "yp-empty" }, "No matches")),
    notice ? h("div", { className: "yp-notice" }, notice) : null,
    (error || engineError) ? h("div", { className: "yp-error" }, error || engineError) : null,
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
    (error || engineError) ? h("div", { className: "yp-error" }, error || engineError) : null,
    miniBar
  );

  const settingsNode = h("div", { className: "yp-body" },
    h("div", { className: "yp-settings" },
      h("div", { className: "yp-label" }, "Standalone player"),
      h("div", { className: "yp-hint" },
        "No sidecar, mpv, or yt-dlp. Playback uses YouTube's embedded player; search reads YouTube's public results page."),

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
      (error || engineError) ? h("div", { className: "yp-error" }, error || engineError) : null
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
          track ? h("button", {
            className: "yp-menu-item",
            onClick: () => { setMenuOpen(false); openExternal(track.url); },
          }, h("span", null, "Open on YouTube"), icon("external", 14)) : null,
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

YouTubePanel._internals = {
  videoIdFromUrl,
  parseYouTubeDuration,
  extractYouTubeInitialData,
  parseYouTubeSearchData,
  normalizeYouTubeVideo,
  searchYouTube,
  resolveYouTubeTrack,
  resolveAudioStream,
  netFetchBuffer,
  LocalQueue,
  YouTubeEngine,
};

module.exports = YouTubePanel;
