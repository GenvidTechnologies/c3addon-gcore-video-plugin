# Manual player test harness

`player-test.html` is a standalone page for exercising the GCore
`@gcorevideo/player` v2 API **outside Construct 3** — useful when debugging
playback, sizing, audio, or subtitle behaviour without the Construct runtime in
the way. There is no automated test suite; this is a manual harness.

## Running it

The page loads the player as an **ES module via dynamic `import()`**, which
Chromium blocks from `file://` origins — so serve it over `http://`:

```bash
# from the repo root
npx http-server -c-1 .      # or: python -m http.server
# then open http://localhost:8080/test/player-test.html
```

Open the browser **console** and **Network** tab. Enter a GCore embed URL or a
direct `…/master.m3u8`, click **Load**, then pick a subtitle language.

Use the demo manifest with subtitle tracks for testing subtitles:
`https://421804.gvideo.io/videos/421804_aRXqc20sxTTLovVV/master.m3u8`
(7 languages). The default Construct sample video has **no** subtitle tracks.

## What it demonstrates (and why the plugin does what it does)

These are the non-obvious facts the harness encodes — see
[`../docs/gcore-player-api.md`](../docs/gcore-player-api.md) for the full write-up:

- **`Player` is a thin wrapper.** It has no caption/track API. The underlying
  Clappr player — `core`, `core.activePlayback`, `closedCaptionsTracks`,
  `setTextTrack` — lives at **`player.player`**.
- **Subtitles load via `activePlayback.setTextTrack(id)`**, which sets
  `hls.subtitleTrack` and fetches the `.vtt`. `player.closedCaptionsTrackId` is a
  no-op on the HLS backend.
- **`renderTextTracksNatively: true`** (passed via `playback.hlsjsConfig`) makes
  the browser render the cues; the player defaults it to `false`.
- **Timing:** a subtitle selection made during hls.js startup is discarded.
  Selecting once playback has advanced ~2s sticks reliably (the plugin defers
  selection until then; clicking a button here naturally happens after startup).

## Automated probing (optional)

This page can also be driven headlessly with Playwright (e.g. capturing console
+ network to confirm `.vtt` segments load and `<video>.textTracks` get cues).
Playwright is not a project dependency; install it in a scratch dir if needed.
