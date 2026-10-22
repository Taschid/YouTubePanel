"use strict";

// Optional live-network check for the standalone search path.
// Run: node .jcode-tests/YouTubePanel.live-search-test.js

const https = require("https");

function request(url, headers = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        ...headers,
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 4) {
        res.resume();
        resolve(request(new URL(res.headers.location, url).toString(), headers, redirects + 1));
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("request timed out")));
  });
}

const ReactFake = {
  createElement: () => null,
  useState: (v) => [typeof v === "function" ? v() : v, () => {}],
  useEffect: () => {},
  useReducer: (r, i) => [i, () => {}],
  useRef: (v) => ({ current: v }),
  Component: class {},
};
const BdApi = function BdApiCtor() {
  return {
    Data: { load: () => ({}), save: () => {} },
    Logger: { info: () => {} },
    DOM: { addStyle: () => {}, removeStyle: () => {} },
    UI: { buildSettingsPanel: (o) => o },
    React: ReactFake,
    ReactDOM: { createRoot: () => ({ render: () => {}, unmount: () => {} }) },
    Webpack: { getByKeys: () => null, getByProps: () => null, getModule: () => null },
  };
};
BdApi.React = ReactFake;
BdApi.Net = {
  fetch: async (url) => {
    const res = await request(String(url));
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      text: async () => res.body,
    };
  },
};
global.BdApi = BdApi;
global.window = {};
global.document = { querySelectorAll: () => [], createElement: () => ({ style: {}, appendChild() {}, remove() {} }), body: { appendChild() {}, contains: () => true } };
global.location = { origin: "https://ptb.discord.com", href: "https://ptb.discord.com/channels/1/2" };

const YouTubePanel = require("../YouTubePanel.plugin.js");
const { searchYouTube, resolveYouTubeTrack } = YouTubePanel._internals;

(async () => {
  let failures = 0;
  const check = (cond, label) => {
    console.log((cond ? "PASS " : "FAIL ") + label);
    if (!cond) failures++;
  };

  const search = await searchYouTube("daft punk around the world");
  check(Array.isArray(search.items) && search.items.length >= 5, "live search returns at least five results");
  check(search.items.every((item) => item.id && item.title && item.url), "live results have ids, titles, and URLs");
  console.log("first result:", search.items[0]?.title, "-", search.items[0]?.artist);

  const track = await resolveYouTubeTrack(search.items[0].id);
  check(!!track.title && track.title !== "YouTube video " + track.id, "oEmbed resolves the title");
  check(track.thumbnail.includes("ytimg"), "oEmbed resolves a thumbnail");

  if (failures) process.exitCode = 1;
})();
