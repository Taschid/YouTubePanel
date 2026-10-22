"use strict";

// YouTubePanel sidecar: local HTTP API that wraps yt-dlp (search/resolve) and
// mpv (audio playback/transport). It binds to 127.0.0.1 only and requires the
// X-Panel-Token header configured in config.json.

const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execFile } = require("child_process");
const { normalizeSearch, normalizeList, normalizeTrack, Queue } = require("./lib");

const ROOT = __dirname;
const PID_FILE = path.join(ROOT, "sidecar.pid");
const LOG_FILE = path.join(ROOT, "sidecar.log");
try { fs.writeFileSync(PID_FILE, String(process.pid), "utf8"); } catch {}
function cleanupPid() {
  try { fs.unlinkSync(PID_FILE); } catch {}
}
process.on("exit", cleanupPid);
const DEFAULTS = {
  port: 8910,
  token: "youtube-panel",
  mpvPath: "mpv",
  ytdlpPath: "yt-dlp",
  volume: 70,
  searchLimit: 15,
};

function loadConfig() {
  const cfg = { ...DEFAULTS };
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
    Object.assign(cfg, raw && typeof raw === "object" ? raw : {});
  } catch {}
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!value || !key.startsWith("--")) continue;
    if (key === "--port") cfg.port = Number(value) || cfg.port;
    else if (key === "--token") cfg.token = String(value);
    else if (key === "--mpv") cfg.mpvPath = String(value);
    else if (key === "--ytdlp") cfg.ytdlpPath = String(value);
    i += 1;
  }
  cfg.port = Number(cfg.port) || DEFAULTS.port;
  cfg.token = String(cfg.token || DEFAULTS.token);
  cfg.volume = Math.max(0, Math.min(100, Number(cfg.volume) || 70));
  cfg.searchLimit = Math.max(1, Math.min(30, Number(cfg.searchLimit) || 15));
  cfg.mpvPath = findMpvPath(cfg.mpvPath);
  return cfg;
}

function findMpvPath(configured) {
  if (configured && configured !== "mpv") return configured;
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "mpv.exe"),
    "C:\\Program Files\\MPV Player\\mpv.exe",
    "C:\\Program Files\\mpv\\mpv.exe",
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "mpv", "mpv.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  }) || configured;
}

const CONFIG = loadConfig();
const queue = new Queue();
let currentTrack = null;
let mpv = null;
let mpvReady = false;
let mpvError = "";
let mpvRequestId = 0;
const mpvPending = new Map();
let ytdlpVersion = "unknown";
let playGeneration = 0;
let advancing = false;
let pausedPosition = 0;
let isPaused = false;
let volume = CONFIG.volume;

function log(...args) {
  const line = "[ytpanel] " + args.map((value) => {
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  }).join(" ");
  console.log(line);
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) fs.writeFileSync(LOG_FILE, "");
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

function runYtdlp(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(CONFIG.ytdlpPath, ["--ignore-config", "--no-cache-dir", ...args], {
      windowsHide: true,
      cwd: ROOT,
      timeout: timeoutMs || 60000,
      maxBuffer: 64 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const lines = String(stderr || error.message || "").trim().split(/\r?\n/).filter(Boolean);
        const detail = lines.slice(-8).join(" ") || error.message || "yt-dlp failed";
        log("yt-dlp failed:", detail);
        reject(new Error(detail));
        return;
      }
      resolve(String(stdout || "").trim());
    });
  });
}

async function readVersion() {
  try {
    ytdlpVersion = (await runYtdlp(["--version"], 15000)) || "unknown";
  } catch (error) {
    ytdlpVersion = "missing: " + error.message;
  }
}

async function search(query) {
  const q = String(query || "").trim();
  if (!q) throw new Error("search query is empty");
  const out = await runYtdlp([
    "--no-warnings",
    "--skip-download",
    "--flat-playlist",
    "--dump-single-json",
    "ytsearch" + CONFIG.searchLimit + ":" + q,
  ]);
  return normalizeSearch(JSON.parse(out), CONFIG.searchLimit);
}

function isPlaylistUrl(url) {
  return /\/playlist\b/i.test(url) || (/(?:\?|&)list=/i.test(url) && !/(?:\?|&)v=/i.test(url));
}

async function resolvePlaylist(url) {
  const out = await runYtdlp([
    "--no-warnings",
    "--skip-download",
    "--flat-playlist",
    "--dump-single-json",
    url,
  ], 120000);
  const payload = JSON.parse(out);
  const items = normalizeList(payload, url);
  if (!items.length) throw new Error("playlist has no playable entries");
  return items;
}

async function resolveSingle(url) {
  const out = await runYtdlp([
    "--no-warnings",
    "--skip-download",
    "--no-playlist",
    "--dump-single-json",
    url,
  ]);
  const payload = JSON.parse(out);
  if (Array.isArray(payload.entries) && payload.entries.length) {
    return normalizeList(payload, url);
  }
  return [normalizeTrack(payload, url)];
}

async function resolveInput(input) {
  const body = input || {};
  if (body.query) {
    const items = await search(body.query);
    if (!items.length) throw new Error("no search results");
    return { tracks: [items[0]], start: 0 };
  }
  const url = String(body.url || "").trim();
  if (!url) throw new Error("url or query is required");
  if (isPlaylistUrl(url)) {
    return { tracks: await resolvePlaylist(url), start: Math.max(0, Number(body.index) || 0) };
  }
  return { tracks: await resolveSingle(url), start: 0 };
}

function mpvPipePath() {
  if (process.platform === "win32") return "\\\\.\\pipe\\youtube-panel-mpv-" + process.pid;
  return path.join(os.tmpdir(), "youtube-panel-mpv-" + process.pid + ".sock");
}

function connectMpv(retries, delayMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(mpvPipePath());
    let settled = false;
    socket.once("connect", () => {
      if (settled) return;
      settled = true;
      resolve(socket);
    });
    socket.once("error", (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (retries > 0) {
        setTimeout(() => connectMpv(retries - 1, delayMs).then(resolve, reject), delayMs);
      } else {
        reject(error || new Error("could not connect to mpv"));
      }
    });
  });
}

function handleMpvLine(line) {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.request_id && mpvPending.has(message.request_id)) {
    const pending = mpvPending.get(message.request_id);
    mpvPending.delete(message.request_id);
    clearTimeout(pending.timer);
    if (message.error && message.error !== "success") pending.reject(new Error(message.error));
    else pending.resolve(message.data);
    return;
  }
  if (message.event === "end-file" && message.reason === "eof") {
    onTrackEnded();
  }
}

class MpvClient {
  constructor() {
    this.proc = null;
    this.socket = null;
    this.buffer = "";
  }

  async start() {
    if (mpvReady && this.socket) return;
    if (this.proc && !this.proc.killed) {
      try {
        this.socket = await connectMpv(10, 100);
        this.attachSocket(this.socket);
        mpvReady = true;
        return;
      } catch {
        try { this.proc.kill(); } catch {}
        this.proc = null;
        this.socket = null;
      }
    }
    mpvError = "";
    const pipe = mpvPipePath();
    const args = [
      "--no-video",
      "--idle=yes",
      "--no-config",
      "--force-window=no",
      "--audio-display=no",
      "--no-terminal",
      "--really-quiet",
      "--input-ipc-server=" + pipe,
      "--volume=" + volume,
    ];
    this.proc = spawn(CONFIG.mpvPath, args, { windowsHide: true, stdio: "ignore" });
    this.proc.on("error", (error) => {
      mpvReady = false;
      mpvError = "mpv failed to start: " + error.message;
      log(mpvError);
      this.rejectPending(new Error(mpvError));
    });
    this.proc.on("exit", (code) => {
      mpvReady = false;
      mpvError = "mpv exited" + (code == null ? "" : " (" + code + ")");
      this.rejectPending(new Error(mpvError));
    });
    try {
      this.socket = await connectMpv(50, 100);
    } catch (error) {
      mpvError = "mpv IPC unavailable: " + error.message;
      throw new Error(mpvError);
    }
    this.attachSocket(this.socket);
    mpvReady = true;
    log("mpv connected at " + pipe);
  }

  attachSocket(socket) {
    this.socket.setEncoding("utf8");
    this.buffer = "";
    this.socket.on("data", (chunk) => {
      this.buffer += chunk;
      const lines = this.buffer.split(/\r?\n/);
      this.buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) handleMpvLine(line);
      }
    });
    this.socket.on("close", () => {
      mpvReady = false;
      this.rejectPending(new Error("mpv IPC closed"));
    });
  }

  rejectPending(error) {
    for (const [id, pending] of mpvPending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      mpvPending.delete(id);
    }
  }

  async command(command) {
    if (!mpvReady) await this.start();
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("mpv is not connected"));
        return;
      }
      const id = ++mpvRequestId;
      const timer = setTimeout(() => {
        mpvPending.delete(id);
        reject(new Error("mpv command timed out: " + command[0]));
      }, 6000);
      mpvPending.set(id, { resolve, reject, timer });
      this.socket.write(JSON.stringify({ command, request_id: id }) + "\n");
    });
  }

  async get(name) {
    try { return await this.command(["get_property", name]); } catch { return null; }
  }

  async set(name, value) {
    return this.command(["set_property", name, value]);
  }

  async load(url) {
    await this.command(["loadfile", url, "replace"]);
    await this.set("pause", false);
  }

  stop() {
    if (this.proc && !this.proc.killed) {
      try { this.proc.kill(); } catch {}
    }
    this.proc = null;
    this.socket = null;
    mpvReady = false;
  }
}

async function getStreamUrl(track) {
  const url = track.videoId
    ? "https://www.youtube.com/watch?v=" + track.videoId
    : track.url;
  if (!url) throw new Error("track has no URL");
  const out = await runYtdlp([
    "--no-warnings",
    "--no-playlist",
    "-g",
    "-f",
    "bestaudio/best",
    url,
  ], 120000);
  const stream = out.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!stream) throw new Error("yt-dlp returned no audio URL");
  return stream;
}

async function playTrack(track) {
  if (!track) throw new Error("nothing to play");
  const generation = ++playGeneration;
  const stream = await getStreamUrl(track);
  if (generation !== playGeneration) return;
  if (!mpv) mpv = new MpvClient();
  await mpv.load(stream);
  if (generation !== playGeneration) return;
  await mpv.set("volume", volume);
  currentTrack = track;
  pausedPosition = 0;
  isPaused = false;
}

async function playCurrent() {
  const track = queue.current();
  if (!track) {
    currentTrack = null;
    isPaused = false;
    pausedPosition = 0;
    return null;
  }
  await playTrack(track);
  return track;
}

async function onTrackEnded() {
  if (advancing) return;
  advancing = true;
  try {
    const next = queue.next(true);
    if (next) {
      await playTrack(next);
    } else {
      currentTrack = null;
      isPaused = false;
      pausedPosition = 0;
    }
  } catch (error) {
    log("advance failed:", error.message);
    mpvError = error.message;
  } finally {
    setTimeout(() => { advancing = false; }, 750);
  }
}

async function state() {
  const track = queue.current() || currentTrack;
  let position = pausedPosition;
  let duration = track ? track.duration : 0;
  let playing = false;
  if (mpvReady && mpv) {
    const pos = await mpv.get("time-pos");
    const dur = await mpv.get("duration");
    if (typeof pos === "number") position = pos;
    if (typeof dur === "number") duration = dur;
    const pause = await mpv.get("pause");
    isPaused = pause === true;
    playing = !!track && !isPaused;
  }
  return {
    ok: true,
    track,
    position: Math.max(0, position || 0),
    duration: Math.max(0, duration || 0),
    isPlaying: playing,
    isPaused,
    volume,
    repeat: queue.repeat,
    shuffle: queue.shuffle,
    queue: queue.toJSON(),
    mpv: mpvReady,
    mpvError,
    ytdlp: ytdlpVersion,
  };
}

function json(res, status, payload) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Panel-Token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
  };
  if (status === 204) {
    res.writeHead(204, headers);
    res.end();
    return;
  }
  const body = JSON.stringify(payload);
  headers["Content-Type"] = "application/json; charset=utf-8";
  headers["Content-Length"] = Buffer.byteLength(body);
  res.writeHead(status, headers);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw.trim()) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

function authorized(req) {
  return String(req.headers["x-panel-token"] || "") === CONFIG.token;
}

async function handle(req, res) {
  if (req.method === "OPTIONS") {
    json(res, 204, {});
    return;
  }
  if (!authorized(req)) {
    json(res, 401, { error: "unauthorized: set the panel token in settings" });
    return;
  }
  const url = new URL(req.url, "http://127.0.0.1");
  const route = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method || "GET";

  try {
    if (method === "GET" && route === "/") {
      json(res, 200, { name: "youtube-panel-sidecar", version: 1 });
      return;
    }
    if (method === "GET" && route === "/health") {
      json(res, 200, {
        ok: true,
        mpv: mpvReady,
        mpvError,
        ytdlp: ytdlpVersion,
        port: CONFIG.port,
      });
      return;
    }
    if (method === "GET" && route === "/search") {
      json(res, 200, { items: await search(url.searchParams.get("q")) });
      return;
    }
    if (method === "GET" && route === "/state") {
      json(res, 200, await state());
      return;
    }
    if (method === "GET" && route === "/queue") {
      json(res, 200, queue.toJSON());
      return;
    }
    if (method !== "POST") {
      json(res, 404, { error: "not found" });
      return;
    }

    const body = await readBody(req);
    if (route === "/play") {
      const input = await resolveInput(body);
      queue.set(input.tracks, input.start);
      const track = await playCurrent();
      json(res, 200, { ok: true, track, state: await state() });
      return;
    }
    if (route === "/playlist") {
      const tracks = await resolvePlaylist(String(body.url || ""));
      queue.set(tracks, 0);
      const track = await playCurrent();
      json(res, 200, { ok: true, track, state: await state() });
      return;
    }
    if (route === "/queue/add") {
      const input = await resolveInput(body);
      for (const track of input.tracks) queue.add(track, !!body.next);
      json(res, 200, { ok: true, tracks: input.tracks, queue: queue.toJSON() });
      return;
    }
    if (route === "/queue/remove") {
      const removed = queue.remove(Number(body.index));
      json(res, 200, { ok: true, removed, queue: queue.toJSON() });
      return;
    }
    if (route === "/jump") {
      const index = Number(body.index);
      if (!Number.isInteger(index) || index < 0 || index >= queue.items.length) {
        throw new Error("invalid queue index");
      }
      queue.index = index;
      const track = queue.current();
      if (track) await playTrack(track);
      json(res, 200, { ok: true, track, state: await state() });
      return;
    }
    if (route === "/pause") {
      if (!mpvReady || !mpv) throw new Error("mpv is not running");
      const pos = await mpv.get("time-pos");
      if (typeof pos === "number") pausedPosition = pos;
      await mpv.set("pause", true);
      isPaused = true;
      json(res, 200, await state());
      return;
    }
    if (route === "/resume") {
      if (!mpvReady || !mpv) throw new Error("mpv is not running");
      await mpv.set("pause", false);
      isPaused = false;
      json(res, 200, await state());
      return;
    }
    if (route === "/next") {
      const track = queue.next(false);
      if (track) await playTrack(track);
      else if (mpvReady && mpv) { try { await mpv.command(["stop"]); } catch {} currentTrack = null; }
      json(res, 200, { ok: true, track, state: await state() });
      return;
    }
    if (route === "/previous") {
      const track = queue.previous();
      if (track) await playTrack(track);
      json(res, 200, { ok: true, track, state: await state() });
      return;
    }
    if (route === "/seek") {
      if (!mpvReady || !mpv) throw new Error("mpv is not running");
      const seconds = Math.max(0, Number(body.seconds) || 0);
      await mpv.command(["seek", seconds, "absolute"]);
      pausedPosition = seconds;
      json(res, 200, await state());
      return;
    }
    if (route === "/volume") {
      volume = Math.max(0, Math.min(100, Number(body.percent) || 0));
      if (mpvReady && mpv) await mpv.set("volume", volume);
      json(res, 200, { ok: true, volume });
      return;
    }
    if (route === "/shuffle") {
      const shuffle = queue.shuffleUpcoming();
      json(res, 200, { ok: true, shuffle, queue: queue.toJSON() });
      return;
    }
    if (route === "/repeat") {
      if (body.state && ["off", "all", "one"].includes(body.state)) queue.repeat = body.state;
      else queue.cycleRepeat();
      json(res, 200, { ok: true, repeat: queue.repeat });
      return;
    }
    if (route === "/stop") {
      queue.clear();
      currentTrack = null;
      isPaused = false;
      pausedPosition = 0;
      if (mpvReady && mpv) {
        try { await mpv.command(["stop"]); } catch {}
      }
      json(res, 200, { ok: true });
      return;
    }
    if (route === "/clear") {
      queue.clear();
      currentTrack = null;
      isPaused = false;
      pausedPosition = 0;
      if (mpvReady && mpv) {
        try { await mpv.command(["stop"]); } catch {}
      }
      json(res, 200, { ok: true, queue: queue.toJSON() });
      return;
    }
    json(res, 404, { error: "not found" });
  } catch (error) {
    log("request failed:", method, route, error.message);
    json(res, 500, { error: error.message || "sidecar error" });
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => json(res, 500, { error: error.message }));
});

server.on("error", (error) => {
  console.error("[ytpanel] server error:", error.message);
  process.exitCode = 1;
});

server.listen(CONFIG.port, "127.0.0.1", async () => {
  log("listening on http://127.0.0.1:" + CONFIG.port);
  log("token=" + CONFIG.token + "  mpv=" + CONFIG.mpvPath + "  yt-dlp=" + CONFIG.ytdlpPath);
  await readVersion();
  log("yt-dlp=" + ytdlpVersion);
  if (!mpv) mpv = new MpvClient();
  try { await mpv.start(); } catch (error) { log(error.message); }
});

process.on("SIGINT", () => {
  if (mpv) mpv.stop();
  server.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  if (mpv) mpv.stop();
  server.close();
  process.exit(0);
});
