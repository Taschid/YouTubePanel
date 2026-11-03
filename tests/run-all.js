#!/usr/bin/env node
"use strict";

/**
 * Test runner for YouTubePanel.
 *
 * Usage:
 *   node tests/run-all.js            # offline suite (lifecycle) - always runnable
 *   node tests/run-all.js --live     # offline suite + live network checks
 *   node tests/run-all.js --all      # same as --live
 *   node tests/run-all.js --help     # this help
 *
 * Exit codes:
 *   0  every suite that ran passed (or was skipped by design)
 *   1  at least one assertion or suite failed
 *   2  bad arguments
 *
 * Output format: each suite prints "PASS <label>" / "FAIL <label>" lines,
 * followed by one "SUMMARY ..." line. Agents should key off the exit code,
 * not the text.
 */

const { spawnSync } = require("child_process");
const path = require("path");

const suites = [
  {
    name: "lifecycle",
    file: "YouTubePanel.lifecycle-test.js",
    offline: true,
    needs: "nothing (Discord/BetterDiscord are mocked)",
    about: "plugin lifecycle, settings panel, queue helpers, Discord bot bridge, panel coexistence",
  },
  {
    name: "live-search",
    file: "YouTubePanel.live-search-test.js",
    offline: false,
    needs: "a running sidecar (tools/youtube-sidecar) plus network access",
    about: "sidecar /health, real /search via yt-dlp, and the /selftest?mode=network playback check",
  },
];

function usage() {
  console.log("YouTubePanel test runner\n");
  console.log("  node tests/run-all.js            run offline suites only");
  console.log("  node tests/run-all.js --live     also run network suites");
  console.log("  node tests/run-all.js --all      alias for --live");
  console.log("  node tests/run-all.js --help     show this help\n");
  console.log("Suites:");
  for (const s of suites) {
    console.log(`  ${s.name.padEnd(12)} ${s.file}`);
    console.log(`               about: ${s.about}`);
    console.log(`               needs: ${s.needs}`);
  }
  console.log("\nExit codes: 0 all good, 1 failure, 2 bad arguments");
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}

const unknown = args.filter((a) => !["--live", "--all", "--offline"].includes(a));
if (unknown.length) {
  console.error(`unknown argument(s): ${unknown.join(" ")}`);
  usage();
  process.exit(2);
}

const runLive = args.includes("--live") || args.includes("--all");

console.log(`node ${process.version} on ${process.platform} ${process.arch}`);
console.log(`running from ${__dirname}\n`);

let failed = 0;
let ran = 0;

for (const suite of suites) {
  if (!suite.offline && !runLive) {
    console.log(`SKIP ${suite.name} (needs network; pass --live to run)`);
    continue;
  }

  ran += 1;
  console.log(`\n=== ${suite.name} (${suite.file}) ===`);
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(__dirname, suite.file)], {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  const ms = Date.now() - started;

  if (result.error) {
    failed += 1;
    console.log(`FAIL ${suite.name} could not start: ${result.error.message}`);
    continue;
  }
  if (result.status !== 0) {
    failed += 1;
    console.log(`FAIL ${suite.name} exited ${result.status} after ${ms}ms`);
  } else {
    console.log(`PASS ${suite.name} (${ms}ms)`);
  }
}

console.log(`\nSUMMARY suites=${ran} failed=${failed}`);
process.exit(failed ? 1 : 0);
