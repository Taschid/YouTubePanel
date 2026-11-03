"use strict";

// Live integration check against a running YouTubePanel sidecar.
// Run: node tests/YouTubePanel.live-search-test.js   (or: node tests/run-all.js --live)
//
// Needs the sidecar from tools/youtube-sidecar (start it with
// start-youtube-panel.cmd) plus network access for the selftest and search.
// If nothing is listening on the configured port the suite SKIPs and exits 0,
// so it is safe to run in CI where the sidecar is absent.
//
// Exits 0 on pass (or skip), 1 on any failure. See tests/AGENTS.md.

const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "tools", "youtube-sidecar", "config.json");

function loadSidecarConfig() {
  const cfg = {
    port: Number(process.env.YOUTUBE_PANEL_PORT) || 8910,
    token: process.env.YOUTUBE_PANEL_TOKEN || "youtube-panel",
  };
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (raw && typeof raw === "object") {
      if (raw.port) cfg.port = Number(raw.port);
      if (raw.token) cfg.token = String(raw.token);
    }
  } catch {
    // no config.json; defaults are what the plugin and sidecar ship with
  }
  return cfg;
}

const cfg = loadSidecarConfig();
const base = `http://127.0.0.1:${cfg.port}`;

function get(pathname, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + pathname, {
      method: "GET",
      headers: { "X-Panel-Token": cfg.token },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on("timeout", () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  let failures = 0;
  const check = (cond, label) => {
    console.log((cond ? "PASS " : "FAIL ") + label);
    if (!cond) failures += 1;
  };

  // ---------------------------------------------------------------- reachable
  let root;
  try {
    root = await get("/", 2000);
  } catch (error) {
    console.log(`SKIP sidecar not reachable on ${base} (${error.code || error.message})`);
    console.log("     start it with tools\\youtube-sidecar\\start-youtube-panel.cmd");
    return;
  }
  check(root.status === 200 && root.json && root.json.name === "youtube-panel-sidecar",
    `sidecar answers on ${base}`);

  if (root.status === 401 || root.status === 403) {
    console.log("FAIL sidecar rejected the token; check X-Panel-Token in config.json");
    process.exitCode = 1;
    return;
  }

  // ------------------------------------------------------------------- health
  const health = await get("/health");
  check(health.status === 200 && health.json && health.json.ok === true, "health reports ok");
  console.log(`     mpv=${health.json?.mpv} ytdlp=${health.json?.ytdlp || "missing"}`);

  // ------------------------------------------------------------------- search
  const search = await get("/search?q=" + encodeURIComponent("daft punk around the world"), 30000);
  check(search.status === 200 && Array.isArray(search.json?.items) && search.json.items.length > 0,
    "live search returns results");
  const items = Array.isArray(search.json?.items) ? search.json.items : [];
  check(items.every((item) => item && item.id && item.title && item.url),
    "live results have id, title and url");
  if (items[0]) console.log(`     first result: ${items[0].title} - ${items[0].artist || "unknown artist"}`);

  // ------------------------------------------------------- end-to-end selftest
  // /selftest?mode=network resolves a stream with yt-dlp and confirms mpv
  // advances, at zero volume, then restores the previous playback state.
  const selftest = await get("/selftest?mode=network", 60000);
  const st = selftest.json || {};
  check(selftest.status === 200 && st.ok === true,
    `network selftest passes${st.mode ? ` (mode=${st.mode})` : ""}`);
  if (st.ok) {
    console.log(`     video=${st.videoId} position=${st.position} duration=${st.duration} elapsedMs=${st.elapsedMs}`);
  } else if (st.error) {
    console.log(`     error: ${st.error}`);
  }

  if (failures) process.exitCode = 1;
})();
