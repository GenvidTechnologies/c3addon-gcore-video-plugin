# GCore player API reference

The plugin integrates the GCore JavaScript video player. All integration lives
in `src/c3runtime/dom/ElementHandler.ts` (see [`architecture.md`](architecture.md)).

## Current API: `@gcorevideo/player` (v2)

- **Package / docs:** <https://github.com/G-Core/gcore-videoplayer-js>
- **Runtime build:** `https://player.gvideo.co/v2/assets/latest/index.js`
- **Player API reference:** `packages/player/docs/api/player.player.md` in that repo.

### Loading — ESM only, no global

The v2 build is an **ES module with named exports and no global object**. There
is no `window.Player`. It is loaded two ways that dedupe via the browser module
registry (same URL → fetched/evaluated once):

1. `plugin.ts` declares `AddRemoteScriptDependency(url, "module")` — injects a
   `<script type="module">` and puts the URL on Construct's CSP/allow-list for
   exported games. A classic `<script>` would fail (can't parse `import`/`export`).
2. `ElementHandler.ts` reaches the `Player` constructor via a cached dynamic
   `import(url)`. Awaiting it also conveniently defers `attachTo()` until after
   Construct has mounted the container `<div>` (there is no longer an iframe
   `load` event to wait on).

### Construction & attachment

The player attaches to a **container DOM node** (a `<div>`) and injects its own
`<video>`; it is **not** an iframe with a `src`.

```ts
Player.registerPlugin(SourceController) // manifest/transport selection
Player.registerPlugin(MediaControl)     // documented minimal companion plugin
Player.registerPlugin(ClosedCaptions)   // subtitle/caption support

const player = new Player({
  autoPlay: true,
  mute: true, // muted autoplay avoids browser autoplay blocks; game unmutes
  sources: [{ source: url, mimeType }],
  // Force native text-track rendering so the browser renders subtitle cues (the
  // player defaults this to false → a custom renderer that doesn't display them).
  playback: { hlsjsConfig: { renderTextTracksNatively: true } },
})
player.attachTo(containerDiv)
```

> **`Player` is a thin wrapper.** It exposes only the high-level methods below
> (`play`, `pause`, `seek`, volume, `resize`, `destroy`, `on`) — **no track or
> caption API**. The underlying Clappr player, with `core`, `core.activePlayback`,
> subtitle tracks and `setTextTrack`, lives at **`player.player`**. Subtitles need
> that inner object (see below).

`mimeType` is derived from the URL path: `.mpd` → `application/dash+xml`,
otherwise `application/x-mpegurl` (HLS). Progressive/direct-file sources are not
supported.

### URL handling — embed URL → manifest

The v2 player needs a **direct manifest URL**, but Construct projects store GCore
**embed page** URLs (`player.gvideo.co/videos|streams/<id>`) — the kind the old
iframe plugin dropped into `iframe.src`. Feeding an embed URL straight to the v2
player fails (`hlsjs … no EXTM3U delimiter` — it fetched an HTML page).

`ElementHandler.ResolveManifest()` bridges this. GCore serves the manifest from
the **account CDN host derived from the client id** (the numeric prefix of the
video id):

```
player.gvideo.co/videos/<clientId>_<tok>
  -> https://<clientId>.gvideo.io/videos/<clientId>_<tok>/master.m3u8
```

So the manifest is derived by string manipulation (verified against both real
content `421804_…` and demo content `2675_…`). The embed host (`player.gvideo.co`)
does **not** serve the manifest — appending `/master.m3u8` there 404s; the CDN
host is the client-id subdomain. Rules:

- URL already ending in `.m3u8`/`.mpd` → used unchanged.
- Recognized embed URL → derived as above.
- Anything else → fallback: `fetch()` the page and scrape `options.multisources[].source`.

### Events — `player.on(PlayerEvent.X, handler)`

`PlayerEvent` values used: `Play` `"play"`, `Pause` `"pause"`, `Ended`
`"ended"`, `Error` `"error"`, `Ready` `"ready"`, `TimeUpdate` `"timeupdate"`,
`VolumeUpdate` `"volumeupdate"` (also `Seek`, `Stop`, `Fullscreen`, `Resize`).

### Control methods — synchronous

`play()`, `pause()`, `seek(seconds)`, `setVolume(0..1)`, `getVolume()`,
`getDuration()`, `mute()`, `unmute()`, `isMuted()`, `destroy()`. Unlike the old
API these return values directly (no callbacks).

### Subtitles (the tricky one)

GCore HLS manifests carry the subtitle renditions in-manifest
(`#EXT-X-MEDIA:TYPE=SUBTITLES,…,LANGUAGE="en"`). Getting them to render took
three non-obvious pieces — all encoded in `ElementHandler.ApplySubtitles()` and
demonstrated by [`../test/player-test.html`](../test/player-test.html):

1. **Reach the real playback.** Tracks and selection live on the inner Clappr
   player: `player.player.core.activePlayback`. It exposes `closedCaptionsTracks`
   (`[{ id, name, track: { language } }]`) and `setTextTrack(id)`. The wrapper's
   `player.closedCaptionsTrackId` is a **no-op** on the HLS backend.
2. **Load via `setTextTrack(id)`.** It sets `hls.subtitleTrack`, which fetches the
   subtitle playlist + `.vtt` segments. (`-1` disables.) Combined with
   `renderTextTracksNatively: true`, the browser renders the cues.
3. **Timing.** hls.js **discards a subtitle selection made during startup**, so
   applying on `ready` leaves the native track disabled with no cues. The plugin
   defers the language selection until a `TimeUpdate` shows playback has advanced
   ~2s (then it sticks reliably). Disabling and later language changes apply
   immediately.

The plugin maps the requested language code to a track by matching against the
track's `language` then `name` (so `en` → "English"). Non-Latin display names
(`ja`, `zh`) rely on the `language` field matching.

## Why not keep the iframe + `gplayerAPI` approach?

The pre-v2 plugin used `gplayerAPI.min.js` (the `globalThis.GcorePlayer.gplayerAPI`
global) to control a `<iframe>` whose `src` was the embed URL, via
`contentWindow.postMessage` — events `.on(name,…)`, commands
`.method({name, params, callback})`.

That controller library is **not gone** — it still returns 200 (now also from
`player.gvideo.co/assets/_players/latest/gplayerAPI.min.js`, `gplayer_api v2.15.99`),
and the embed page still plays. The reason the plugin was ported off it is a
**bug in GCore's embed player** (`gcore.min.js`, current `latest`) that we cannot
patch: a half-finished `this.player` → `this.#player` refactor left a dangling
reference in `checkReady()`:

```js
checkReady() {
  if (this.#player.ready /* TODO */) {        // refactored
    if (this.iframeApiReady) {
      this.sendEvent('ready', {
        video360: !!this.player.options.video360,  // STILL this.player → undefined → throws
      });
```

When the `apiInit` handshake fires, `this.player.options` throws
`Cannot read properties of undefined (reading 'options')`, so the embed never
emits `ready`. `gplayerAPI.method()` only forwards commands after `ready`
(`if (this.readyConversation)`), so **playback works but all control silently
no-ops**. The fix is one line on GCore's side
(`this.player.options` → `this.#player.options`); until they ship it, the iframe
control path is dead and the DOM-native v2 SDK is the working approach. If GCore
fixes it, revisit — the iframe path preserves their server-side ads/stats/CDN/auth
provisioning that the DOM-native path does not.

## Status & follow-ups

Verified working in a Construct 3 preview: playback, embed-URL → manifest
resolution, container sizing/resize, ready-state, mute/volume persistence across
videos, and subtitle selection/rendering.

- **Low latency is not wired into v2.** The legacy `no_low_latency` URL query
  param is dropped during manifest resolution; proper low-latency config is a
  follow-up (GitHub issue #1).
- `setVolume`/`getVolume` round-trip in the player's own units (the ACE value is
  passed through as-is) — confirm the game's volume range matches if it matters.
