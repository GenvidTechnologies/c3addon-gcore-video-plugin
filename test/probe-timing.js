/*
 * test/probe-timing.js — C5 Load Timing Probe (headless Playwright automation)
 *
 * HOW TO RUN:
 *   Prerequisites — install Playwright once (not a project dependency):
 *     npm install -D playwright        # project-local
 *       then: npx playwright install chromium
 *     -- OR --
 *     npm install -g playwright        # global
 *       then: playwright install chromium
 *
 *   From the repo root:
 *     # Option A — let the script auto-start the server:
 *     node test/probe-timing.js
 *
 *     # Option B — serve the repo yourself first (then the script reuses it):
 *     npx http-server -p 8080 -c-1 .
 *     node test/probe-timing.js
 *
 *   The script detects whether localhost:8080 is already serving. If not it
 *   spawns `npx http-server -p 8080 -c-1 .` from the repo root and kills it
 *   on exit. Either way it logs which mode it chose.
 *
 * FINDINGS (cold-manifest run 2026-06-26, default 7-language master.m3u8,
 *           hls backend; deltas measured from the Load click):
 *   t_module:              +1117 ms  (player module import resolved)
 *   t_ready:               +1196 ms  (Ready event — fires BEFORE playback starts)
 *   t_cc_tracks_populated: +1502 ms  (7 tracks [en,de,fr,pt,es,ja,zh]; ~307 ms AFTER Ready)
 *   t_first_timeupdate:    +2239 ms  (playback actually begins; current=0.148s)
 *   t_playback_stable:     +4349 ms  (current=2.218s, baseline=0.148s — ~2s of playback)
 *   Q-seek result:         target 30.00s (dur 1637.03s) -> landed current=30.490s  [R2 PASS]
 *   Q-subs result:         selected id=0 lang=en -> <video> showing=true cues=33   [R1 PASS]
 *
 * CONCLUSIONS (gate PASSED — resolve the awaitable load at Ready, no change to the plan):
 *   - Ready is playback-INDEPENDENT: it fires ~1s before the first TimeUpdate and ~3s
 *     before the 2s-stable point. It means "URL setup complete", not "playing".
 *   - levels[] (4) and the seekable range (end=1637s) are available at/just after Ready:
 *     a seek issued right after Ready lands precisely (R2).
 *   - In-manifest CC tracks populate ~307ms AFTER Ready, so a Set Subtitles issued at the
 *     exact Ready instant sees an empty list — but the existing deferred-apply path
 *     (store subtitleLang, re-apply on the stable TimeUpdate) makes the "en" track end up
 *     showing with cues (R1). The load contract does NOT need to wait for the 2s settle.
 *   - The ~2s playbackStable gate is a SUBTITLE-DISPLAY concern (2s of real playback),
 *     correctly kept in the subtitle path, NOT in the load-readiness contract.
 */

'use strict';

const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

// ── Configuration ────────────────────────────────────────────────────────────

const PORT = 8080;
const BASE_URL = `http://localhost:${PORT}`;
const PAGE_URL = `${BASE_URL}/test/player-test.html`;
const MANIFEST_URL = 'https://421804.gvideo.io/videos/421804_aRXqc20sxTTLovVV/master.m3u8';

const READY_TIMEOUT_MS  = 30000;  // how long to wait for C5 t_ready
const STABLE_WAIT_MS    =  8000;  // how long to wait for C5 t_playback_stable after ready
const SUBS_WAIT_MS      =  4000;  // how long to wait after clicking Q-subs

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check whether localhost:PORT is already serving by making a quick HTTP GET.
 * Resolves true if a response is received (any status code), false otherwise.
 * @returns {Promise<boolean>}
 */
function isServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(BASE_URL + '/', { timeout: 2000 }, (res) => {
      res.resume(); // discard body
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * Spawn `npx http-server -p PORT -c-1 .` from repoRoot.
 * Returns the ChildProcess so the caller can kill it on exit.
 * @param {string} repoRoot
 * @returns {import('child_process').ChildProcess}
 */
function spawnServer(repoRoot) {
  console.log(`[probe] Spawning http-server at ${BASE_URL} (cwd=${repoRoot}) ...`);
  const proc = spawn('npx', ['http-server', '-p', String(PORT), '-c-1', '.'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  proc.stdout.on('data', (d) => process.stdout.write(`[http-server] ${d}`));
  proc.stderr.on('data', (d) => process.stderr.write(`[http-server] ${d}`));
  proc.on('exit', (code) => {
    if (code !== null && code !== 0) {
      process.stderr.write(`[http-server] exited with code ${code}\n`);
    }
  });
  return proc;
}

/**
 * Poll predicate every intervalMs until it returns true or timeoutMs elapses.
 * @param {() => boolean} predicate  Synchronous check.
 * @param {number} timeoutMs
 * @param {number} [intervalMs=500]
 * @returns {Promise<boolean>} true if predicate satisfied, false on timeout.
 */
function waitFor(predicate, timeoutMs, intervalMs = 500) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (predicate()) { resolve(true); return; }
      if (Date.now() >= deadline) { resolve(false); return; }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

/**
 * Ensure the http server is reachable at PORT.
 * If not already running, spawns it and waits up to 5s for it to bind.
 * Returns the spawned ChildProcess (or null if reused an existing server).
 * @param {string} repoRoot
 * @returns {Promise<import('child_process').ChildProcess|null>}
 */
async function ensureServer(repoRoot) {
  if (await isServerRunning()) {
    console.log(`[probe] localhost:${PORT} already serving — reusing existing server.`);
    return null;
  }

  const proc = spawnServer(repoRoot);

  // Wait up to 5s for the server to bind (poll every 500ms)
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isServerRunning()) {
      console.log(`[probe] http-server ready at ${BASE_URL}`);
      return proc;
    }
  }

  console.error('[probe] http-server did not become ready within 5s — aborting.');
  try { proc.kill('SIGTERM'); } catch (_) {}
  process.exit(1);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const repoRoot = path.resolve(__dirname, '..');

  /** @type {Array<{wallMs: number, text: string}>} */
  const c5Lines = [];
  let serverProc = null;
  let browser = null;

  try {
    // ── Step 1: Ensure http-server is available ───────────────────────────
    serverProc = await ensureServer(repoRoot);

    // ── Step 2: Launch Chromium headlessly ────────────────────────────────
    console.log('[probe] Launching Chromium (headless) ...');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // Collect ALL console messages; capture those starting with "C5"
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.startsWith('C5')) {
        c5Lines.push({ wallMs: Date.now(), text });
        console.log(`[C5] ${text}`);
      }
    });

    // Forward page errors so they are visible in the terminal
    page.on('pageerror', (err) => {
      console.error(`[page-error] ${err.message}`);
    });

    // ── Step 3: Navigate to the harness ──────────────────────────────────
    console.log(`[probe] Navigating to ${PAGE_URL} ...`);
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Set the URL input explicitly (it already defaults to MANIFEST_URL, but
    // setting it here makes the script self-contained if the default changes)
    await page.fill('#url', MANIFEST_URL);

    console.log('[probe] Clicking #load ...');
    await page.click('#load');

    // ── Step 4: Wait for C5 t_ready ──────────────────────────────────────
    console.log(`[probe] Waiting for C5 t_ready (timeout ${READY_TIMEOUT_MS / 1000}s) ...`);
    const readyFound = await waitFor(
      () => c5Lines.some((l) => l.text.includes('C5 t_ready')),
      READY_TIMEOUT_MS,
    );

    if (!readyFound) {
      console.error(
        `[probe] ERROR: "C5 t_ready" never appeared in console within ${READY_TIMEOUT_MS / 1000}s.\n` +
        '[probe] Collected C5 lines so far:\n' +
        (c5Lines.length ? c5Lines.map((l) => `  ${l.text}`).join('\n') : '  (none)'),
      );
      process.exitCode = 1;
      return;
    }

    // ── Step 5: Click Q-seek right after ready ────────────────────────────
    console.log('[probe] C5 t_ready received — clicking #c5SeekAtReady ...');
    await page.click('#c5SeekAtReady');

    // Wait up to STABLE_WAIT_MS for t_playback_stable (the 2s-advance milestone).
    // We proceed regardless; if stable never fires it might mean a live stream.
    console.log(`[probe] Waiting up to ${STABLE_WAIT_MS / 1000}s for C5 t_playback_stable ...`);
    const stableFound = await waitFor(
      () => c5Lines.some((l) => l.text.includes('C5 t_playback_stable')),
      STABLE_WAIT_MS,
    );
    if (!stableFound) {
      console.log('[probe] C5 t_playback_stable did not appear (live stream or slow network) — proceeding anyway.');
    }

    // ── Step 6: Click Q-subs and wait for the result ──────────────────────
    console.log('[probe] Clicking #c5SubAtReady ...');
    await page.click('#c5SubAtReady');

    console.log(`[probe] Waiting ${SUBS_WAIT_MS / 1000}s for Q-subs result ...`);
    await waitFor(
      () => c5Lines.some((l) => l.text.includes('C5 Q-subs result:')),
      SUBS_WAIT_MS + 1000, // add 1s grace
    );

    // ── Step 7: Print ordered results table ──────────────────────────────
    const startWall = c5Lines.length > 0 ? c5Lines[0].wallMs : Date.now();
    console.log('\n=== C5 TIMING RESULTS ===');
    console.log('  #  | +wall(ms) | Message');
    console.log('-----|-----------|' + '-'.repeat(70));
    c5Lines.forEach((l, i) => {
      const idx     = String(i + 1).padStart(3);
      const relMs   = String(l.wallMs - startWall).padStart(9);
      console.log(`  ${idx} | ${relMs} | ${l.text}`);
    });
    console.log('=========================\n');

  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
    if (serverProc) {
      console.log('[probe] Killing http-server ...');
      try { serverProc.kill('SIGTERM'); } catch (_) {}
    }
  }
}

main().catch((err) => {
  console.error('[probe] Unexpected error:', err);
  process.exit(1);
});
