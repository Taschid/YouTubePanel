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
    else if (key === "--ffmpeg") cfg.ffmpegPath = String(value);
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
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "MPV Player", "mpv.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "mpv", "mpv.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "mpv", "mpv.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  }) || configured;
}

const CONFIG = loadConfig();

// ---------------------------------------------------------------------------
// PATH hardening.
//
// yt-dlp probes every PATH entry looking for ffmpeg. A junction or mount point
// in PATH (for example the Cua driver bin) makes Windows raise WinError 448
// ("untrusted mount point") and aborts the whole call. We therefore build an
// allowlist PATH once at startup: our own bin folders, the directory holding a
// trusted ffmpeg, then the inherited PATH filtered down to real directories
// that are not symlinks, junctions, or other reparse points.

const PATH_REJECTED = [];
const PATH_STATE = {
  initial: "",
  safe: "",
  entries: [],
  ffmpegDir: "",
  ffmpegSource: "",
};

function stripQuotes(value) {
  return String(value == null ? "" : value).trim().replace(/^"(.*)"$/, "$1").trim();
}

// Returns null when the entry is a usable, non-reparse directory, otherwise a
// short reason string. Any lstat/stat failure (448, EACCES, EPERM, ENOENT, ...)
// disqualifies the entry.
function unsafeDirReason(entry) {
  if (!entry) return "empty";
  if (entry.includes('"')) return "invalid quotes";
  try {
    const lst = fs.lstatSync(entry);
    if (lst.isSymbolicLink()) return "symlink/junction";
    const st = fs.statSync(entry);
    if (!st.isDirectory()) return "not a directory";
    return null;
  } catch (error) {
    const message = String((error && error.message) || "");
    const code = String((error && error.code) || "");
    if (/448/.test(message) || /448/.test(code)) return "WinError 448 (untrusted mount point)";
    return "stat failed" + (code ? ": " + code : "");
  }
}

function sanitizePathEntries(entries, recordRejections) {
  const out = [];
  const seen = new Set();
  const seenRejected = new Set(PATH_REJECTED.map((item) => item.entry.toLowerCase()));
  for (const raw of entries) {
    const entry = stripQuotes(raw);
    if (!entry) continue;
    let key;
    try { key = path.resolve(entry).toLowerCase(); } catch { key = entry.toLowerCase(); }
    if (seen.has(key)) continue;
    const reason = unsafeDirReason(entry);
    if (reason) {
      if (recordRejections && !seenRejected.has(entry.toLowerCase())) {
        seenRejected.add(entry.toLowerCase());
        PATH_REJECTED.push({ entry, reason });
      }
      continue;
    }
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function envPathEntries(value) {
  return String(value || "").split(";").map((item) => stripQuotes(item)).filter(Boolean);
}

function ffmpegDirFrom(value) {
  const candidate = stripQuotes(value);
  if (!candidate) return "";
  try {
    const st = fs.statSync(candidate);
    if (st.isDirectory()) {
      return unsafeDirReason(candidate) ? "" : candidate;
    }
    if (st.isFile()) {
      const dir = path.dirname(candidate);
      return unsafeDirReason(dir) ? "" : dir;
    }
  } catch {}
  return "";
}

// Checks config.ffmpegPath, then ROOT\bin\ffmpeg.exe, then the sanitized PATH.
function resolveFfmpegDir(safeBaseEntries) {
  const configured = CONFIG.ffmpegPath;
  if (configured) {
    const dir = ffmpegDirFrom(configured);
    if (dir) return { dir, source: "config.ffmpegPath (" + configured + ")" };
  }
  const bundled = path.join(ROOT, "bin", "ffmpeg.exe");
  const bundledDir = ffmpegDirFrom(bundled);
  if (bundledDir) return { dir: bundledDir, source: "bundled " + bundled };
  for (const entry of safeBaseEntries) {
    try {
      if (fs.statSync(path.join(entry, "ffmpeg.exe")).isFile()) {
        return { dir: entry, source: "PATH entry " + entry };
      }
    } catch {}
  }
  return { dir: "", source: "not found" };
}

function initializePath() {
  const inherited = String(process.env.PATH || "");
  const inheritedEntries = envPathEntries(inherited);
  const base = sanitizePathEntries(
    [path.join(ROOT, "bin"), path.join(ROOT, "runtime"), ...inheritedEntries],
    true
  );
  const ffmpeg = resolveFfmpegDir(base);
  const finalEntries = sanitizePathEntries(
    [path.join(ROOT, "bin"), path.join(ROOT, "runtime"), ffmpeg.dir, ...inheritedEntries],
    false
  );
  PATH_STATE.initial = inherited;
  PATH_STATE.entries = finalEntries;
  PATH_STATE.safe = finalEntries.join(";");
  PATH_STATE.ffmpegDir = ffmpeg.dir;
  PATH_STATE.ffmpegSource = ffmpeg.source;
  process.env.PATH = PATH_STATE.safe;
  return PATH_STATE;
}

initializePath();

// Build a child env whose PATH is exactly the value we want, regardless of how
// the inherited environment capitalised the key.
function childEnv(pathValue) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === "PATH") delete env[key];
  }
  env.PATH = pathValue;
  return env;
}

// Last-resort PATH for the 448 retry: only our own folders and the Windows
// directories, no user-installed tooling.
function minimalYtdlpPath() {
  const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  return [
    path.join(ROOT, "bin"),
    path.join(ROOT, "runtime"),
    path.join(systemRoot, "System32"),
    systemRoot,
  ].join(";");
}

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

// ---------------------------------------------------------------------------
// yt-dlp execution.

function ytdlpArgList(args, includeFfmpeg) {
  const list = ["--ignore-config", "--no-cache-dir"];
  if (includeFfmpeg && PATH_STATE.ffmpegDir) {
    list.push("--ffmpeg-location", PATH_STATE.ffmpegDir);
  }
  return list.concat(args);
}

function truncate(value, max) {
  const text = String(value == null ? "" : value);
  return text.length > max ? text.slice(0, max) + "... (truncated)" : text;
}

function ytdlpStderrLines(error) {
  const stderr = String((error && error.stderr) || "");
  const message = String((error && error.message) || "");
  const source = stderr.trim() ? stderr : message;
  return source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function isUntrustedMountError(text) {
  return /WinError\s*448|untrusted mount point/i.test(String(text || ""));
}

function execYtdlp(args, timeoutMs, pathValue, includeFfmpeg) {
  return new Promise((resolve, reject) => {
    const finalArgs = ytdlpArgList(args, includeFfmpeg);
    const commandLine = CONFIG.ytdlpPath + " " + finalArgs.join(" ");
    execFile(CONFIG.ytdlpPath, finalArgs, {
      windowsHide: true,
      cwd: ROOT,
      timeout: timeoutMs || 60000,
      maxBuffer: 64 * 1024 * 1024,
      env: childEnv(pathValue),
    }, (error, stdout, stderr) => {
      if (error) {
        const lines = ytdlpStderrLines({ stderr, message: error.message });
        error.ytdlpLines = lines;
        error.ytdlpDetail = lines.slice(-8).join(" ") || error.message || "yt-dlp failed";
        error.ytdlpCommand = commandLine;
        reject(error);
        return;
      }
      resolve(String(stdout || "").trim());
    });
  });
}

// Points at the PATH entry most likely responsible for a 448: one we rejected
// at startup and that appears in the yt-dlp output, else the first rejected
// reparse point / blocked entry from the startup log.
function findLikelyPathOffender(text) {
  const haystack = String(text || "");
  const lower = haystack.toLowerCase();
  for (const item of PATH_REJECTED) {
    if (item.entry && lower.includes(item.entry.toLowerCase())) {
      return item.entry + " (" + item.reason + ")";
    }
  }
  const blocked = PATH_REJECTED.filter((item) =>
    /448|untrusted|symlink|junction|EPERM|EACCES/i.test(item.reason));
  if (blocked.length) return blocked[0].entry + " (" + blocked[0].reason + ")";
  const quoted = haystack.match(/[A-Za-z]:\\[^\r\n'"]+/g) || [];
  if (quoted.length) return quoted[0].trim();
  return "";
}

function ytdlpFailure(error, firstError) {
  const detail = error.ytdlpDetail || error.message || "yt-dlp failed";
  const lines = Array.isArray(error.ytdlpLines) ? error.ytdlpLines : [];
  log("yt-dlp failed: " + truncate(error.ytdlpCommand || "(unknown command)", 4000));
  for (const line of lines.slice(-8)) log("  stderr: " + line);
  if (firstError) {
    log("yt-dlp first attempt failed: " + truncate(firstError.ytdlpDetail || firstError.message, 2000));
  }
  const combined = [
    detail,
    lines.slice(-8).join("\n"),
    firstError ? (firstError.ytdlpDetail || firstError.message || "") : "",
  ].join("\n");
  if (isUntrustedMountError(combined)) {
    const offender = findLikelyPathOffender(combined);
    const where = offender ? "Likely blocked PATH entry: " + offender + ". " : "";
    return new Error(
      "WinError 448 (untrusted mount point): Windows blocked traversal of a PATH entry. " +
      where + "Restart the sidecar; see sidecar.log for the sanitized PATH and the failing command."
    );
  }
  return new Error(detail);
}

async function runYtdlp(args, timeoutMs) {
  try {
    return await execYtdlp(args, timeoutMs, PATH_STATE.safe, true);
  } catch (error) {
    if (!isUntrustedMountError(error.ytdlpDetail || error.message)) {
      throw ytdlpFailure(error);
    }
    log("yt-dlp hit WinError 448 with sanitized PATH; retrying once with minimal PATH and no --ffmpeg-location");
    log("yt-dlp retry minimal PATH=" + minimalYtdlpPath());
    try {
      const out = await execYtdlp(args, timeoutMs, minimalYtdlpPath(), false);
      log("yt-dlp 448 retry succeeded");
      return out;
    } catch (retryError) {
      throw ytdlpFailure(retryError, error);
    }
  }
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

// ---------------------------------------------------------------------------
// Install-time self test.
//
// Two independent checks:
//
//   mode=local   mpv + audio device only. Generates a short silent PCM WAV in
//                os.tmpdir(), loads it in mpv at volume 0, waits for time-pos
//                to advance, then stops and deletes the temp file. No network
//                and no yt-dlp. This is the hard install check.
//
//   mode=network yt-dlp -> mpv. Resolves the configured test video with
//                `yt-dlp -g -f bestaudio/best`, loads it in mpv at volume 0,
//                and waits for time-pos to advance.
//
//   no mode      auto: network first, local fallback. `mode` names the check
//                that passed and `fallback` says whether network failed.
//
// Either check briefly interrupts whatever is playing; this is install-time
// only. Both stop mpv and restore the previous volume when done.

const SELFTEST_VIDEO_IDS = Array.from(new Set([
  CONFIG.selftestVideoId,
  "9vdgd4F9CuI",
  "jNQXAC9IVRw",
].filter((value) => typeof value === "string" && /^[\w-]{6,}$/.test(value))));
const SELFTEST_TIMEOUT_MS = 20000;
const SELFTEST_NETWORK_ATTEMPTS = 2;
const SELFTEST_LOCAL_ATTEMPTS = 1;
const SELFTEST_LOCAL_POLL_MS = 250;
const SELFTEST_NETWORK_POLL_MS = 500;
const SELFTEST_WAV_SECONDS = 4;
const SELFTEST_WAV_RATE = 8000;
const SELFTEST_CONTRACT =
  "mode=local: mpv/audio only via a silent temp WAV (no network, no yt-dlp); " +
  "mode=network: yt-dlp resolve plus mpv playback; " +
  "no mode: auto, network first with local fallback, and mode names the check that passed";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 16-bit mono PCM WAV of pure silence. mpv decodes PCM WAV internally, so this
// works even when the bundled ffmpeg is the thing under test.
function writeSilentWav(filePath, seconds) {
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = SELFTEST_WAV_RATE * blockAlign;
  const dataSize = Math.max(1, Math.round(SELFTEST_WAV_RATE * seconds)) * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, 4, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, 4, "ascii");
  buffer.write("fmt ", 12, 4, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(SELFTEST_WAV_RATE, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, 4, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// mpv can keep the file handle briefly after "stop", so retry the unlink.
async function removeTempFile(filePath) {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      fs.unlinkSync(filePath);
      log("selftest local: removed temp " + filePath);
      return true;
    } catch (error) {
      if (error && error.code === "ENOENT") {
        log("selftest local: temp already gone " + filePath);
        return true;
      }
      if (attempt === 10) {
        log("selftest local: could not remove temp " + filePath + ": " + (error && error.message ? error.message : String(error)));
        return false;
      }
      await sleep(100);
    }
  }
  return false;
}

// Poll time-pos until it advances or the deadline passes.
async function waitForTimePos(client, deadline, pollMs) {
  let position = 0;
  let duration = 0;
  let previousPosition = null;
  let advanced = false;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const pos = await client.get("time-pos");
    const dur = await client.get("duration");
    if (typeof dur === "number" && dur > 0) duration = dur;
    if (typeof pos === "number" && pos >= 0) {
      position = pos;
      if (previousPosition !== null && pos > previousPosition + 0.02) {
        advanced = true;
        break;
      }
      previousPosition = pos;
    }
  }
  return { position, duration, advanced };
}

async function stopSelftestPlayback(previousVolume, label) {
  if (!mpv) return;
  try { await mpv.command(["stop"]); } catch (error) { log("selftest " + label + ": stop failed: " + error.message); }
  try { await mpv.set("volume", previousVolume); } catch (error) { log("selftest " + label + ": volume restore failed: " + error.message); }
}

async function runLocalSelftestOnce() {
  const startedAt = Date.now();
  const wavPath = path.join(os.tmpdir(), "youtube-panel-selftest-" + process.pid + "-" + startedAt + ".wav");
  log("selftest local: start temp=" + wavPath);
  const previousVolume = volume;
  let touchedPlayback = false;
  try {
    writeSilentWav(wavPath, SELFTEST_WAV_SECONDS);
    if (!mpv) mpv = new MpvClient();
    await mpv.start();
    await mpv.set("volume", 0);
    touchedPlayback = true;
    await mpv.load(wavPath);
    const result = await waitForTimePos(mpv, Date.now() + SELFTEST_TIMEOUT_MS, SELFTEST_LOCAL_POLL_MS);
    if (!result.advanced) {
      throw new Error("mpv loaded the silent WAV but time-pos did not advance within " +
        (SELFTEST_TIMEOUT_MS / 1000) + "s");
    }
    const elapsedMs = Date.now() - startedAt;
    log("selftest local: pass temp=" + wavPath +
      " position=" + result.position.toFixed(2) +
      " duration=" + result.duration.toFixed(2) +
      " elapsedMs=" + elapsedMs);
    return { ok: true, mode: "local", duration: result.duration, elapsedMs };
  } catch (error) {
    log("selftest local: fail temp=" + wavPath +
      " elapsedMs=" + (Date.now() - startedAt) +
      ": " + (error && error.message ? error.message : String(error)));
    throw error;
  } finally {
    if (touchedPlayback) await stopSelftestPlayback(previousVolume, "local");
    await removeTempFile(wavPath);
    currentTrack = null;
    pausedPosition = 0;
    isPaused = false;
  }
}

async function runNetworkSelftestOnce(videoId) {
  const startedAt = Date.now();
  log("selftest network: start (" + videoId + ")");
  const previousVolume = volume;
  let touchedPlayback = false;
  try {
    const stream = await getStreamUrl({
      videoId,
      url: "https://www.youtube.com/watch?v=" + videoId,
    });
    if (!/^https?:\/\//i.test(stream)) throw new Error("yt-dlp did not return a usable stream URL");
    log("selftest network: stream URL resolved (" + videoId + ")");
    if (!mpv) mpv = new MpvClient();
    await mpv.start();
    await mpv.set("volume", 0);
    touchedPlayback = true;
    await mpv.load(stream);
    const result = await waitForTimePos(mpv, Date.now() + SELFTEST_TIMEOUT_MS, SELFTEST_NETWORK_POLL_MS);
    if (!result.advanced) {
      throw new Error("mpv loaded the test stream but time-pos did not advance within " +
        (SELFTEST_TIMEOUT_MS / 1000) + "s");
    }
    const elapsedMs = Date.now() - startedAt;
    log("selftest network: pass videoId=" + videoId +
      " position=" + result.position.toFixed(2) +
      " duration=" + result.duration.toFixed(1) +
      " elapsedMs=" + elapsedMs);
    return { ok: true, mode: "network", videoId, position: result.position, duration: result.duration, elapsedMs };
  } catch (error) {
    log("selftest network: fail videoId=" + videoId +
      " elapsedMs=" + (Date.now() - startedAt) +
      ": " + (error && error.message ? error.message : String(error)));
    throw error;
  } finally {
    if (touchedPlayback) await stopSelftestPlayback(previousVolume, "network");
    currentTrack = null;
    pausedPosition = 0;
    isPaused = false;
  }
}

async function runLocalSelftest() {
  let lastError = null;
  for (let attempt = 1; attempt <= SELFTEST_LOCAL_ATTEMPTS; attempt += 1) {
    try {
      const result = await runLocalSelftestOnce();
      return { ...result, attempts: attempt, contract: SELFTEST_CONTRACT };
    } catch (error) {
      lastError = error;
      log("selftest local: attempt " + attempt + "/" + SELFTEST_LOCAL_ATTEMPTS + " failed: " +
        (error && error.message ? error.message : String(error)));
      if (attempt < SELFTEST_LOCAL_ATTEMPTS) await sleep(1000);
    }
  }
  throw lastError || new Error("local selftest failed");
}

async function runNetworkSelftest() {
  let lastError = null;
  for (const videoId of SELFTEST_VIDEO_IDS) {
    for (let attempt = 1; attempt <= SELFTEST_NETWORK_ATTEMPTS; attempt += 1) {
      try {
        const result = await runNetworkSelftestOnce(videoId);
        return { ...result, attempts: attempt, contract: SELFTEST_CONTRACT };
      } catch (error) {
        lastError = error;
        log("selftest network: attempt " + attempt + "/" + SELFTEST_NETWORK_ATTEMPTS +
          " failed for " + videoId + ": " + (error && error.message ? error.message : String(error)));
        if (attempt < SELFTEST_NETWORK_ATTEMPTS) await sleep(1000);
      }
    }
  }
  throw lastError || new Error("network selftest failed for all configured test videos");
}

async function runSelftest(mode) {
  if (mode === "local") return runLocalSelftest();
  if (mode === "network") return runNetworkSelftest();
  let networkError = null;
  try {
    const result = await runNetworkSelftest();
    return { ...result, fallback: false };
  } catch (error) {
    networkError = error;
    log("selftest auto: network check failed, falling back to local: " +
      (error && error.message ? error.message : String(error)));
  }
  try {
    const result = await runLocalSelftest();
    return {
      ...result,
      fallback: true,
      networkError: networkError && networkError.message ? networkError.message : String(networkError),
    };
  } catch (error) {
    throw new Error(
      "network selftest failed (" +
      (networkError && networkError.message ? networkError.message : String(networkError)) +
      "); local selftest failed (" + (error && error.message ? error.message : String(error)) + ")"
    );
  }
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
    if (method === "GET" && route === "/selftest") {
      const requested = String(url.searchParams.get("mode") || "").trim().toLowerCase();
      const mode = requested || "auto";
      if (!["auto", "local", "network"].includes(mode)) {
        json(res, 400, {
          ok: false,
          error: "invalid selftest mode: " + requested + " (use local, network, or omit mode for auto)",
        });
        return;
      }
      log("selftest: requested mode=" + mode);
      json(res, 200, await runSelftest(mode));
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
  log("PATH=" + PATH_STATE.safe);
  log("ffmpeg=" + (PATH_STATE.ffmpegDir || "not found") + " (" + PATH_STATE.ffmpegSource + ")");
  for (const item of PATH_REJECTED) {
    log("PATH rejected: " + item.entry + " (" + item.reason + ")");
  }
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
