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

The full `PlayerEvent` enum (confirmed 2026-06-22 against v2 at
`player.gvideo.co/v2/assets/latest/index.js`) has exactly **11 keys**:
`Ended`, `Error`, `Fullscreen`, `Ready`, `Play`, `Pause`, `Resize`, `Seek`,
`Stop`, `TimeUpdate`, `VolumeUpdate`. There is **no quality/level-change
event** — see the Quality levels section below.

`PlayerEvent` values used by the plugin: `Play` `"play"`, `Pause` `"pause"`,
`Ended` `"ended"`, `Error` `"error"`, `Ready` `"ready"`, `TimeUpdate`
`"timeupdate"`, `VolumeUpdate` `"volumeupdate"`.

**TimeUpdate payload (confirmed):** `{ current, total }` — e.g.
`{ current: 138.18, total: 1637.03 }`. The plugin's destructuring of
`{ current, total }` is correct.

**Error payload (confirmed, richer than the wrapper implies):** The error
object carries `.message` (e.g. `"hls error: type: networkError, details:
manifestLoadError"`), `.code` (string enum, e.g. `"MEDIA_SOURCE_UNAVAILABLE"`),
`.level` (`"FATAL"`), `.origin` (`"hls"`), `.scope` (`"playback"`),
`.description`, and `.UI.message`. `err.message` is reliably present; the
plugin's `err.message ?? String(err)` fallback is correct.

> **Caveat — Error fires repeatedly:** On a failing source (bad URL, network
> error) the Error event fires **once per hls.js retry**, not once per failure.
> The `OnError` trigger will re-fire many times for a single bad stream URL.

### Control methods — synchronous

`play()`, `pause()`, `seek(seconds)`, `setVolume(n)`, `getVolume()`,
`getDuration()`, `mute()`, `unmute()`, `isMuted()`, `destroy()`. Unlike the old
API these return values directly (no callbacks).

**Volume units — A3, confirmed 0..100 range, wrapped at ElementHandler boundary
(resolved in 2.0.0.0):**
`setVolume` and `getVolume` operate in **percent (0..100)**, not 0..1.
Empirically, `setVolume(0.5)` set the underlying `<video>.volume` to `0.005`
(the player divides the argument by 100), while `getVolume()` returned `0.5`
(the wrapper echoes the as-set value, not the media-element level).

As of v2.0.0.0 the plugin wraps this at the `ElementHandler` boundary: the
`SetVolume` / `GetCurrentVolume` ACEs present a **0..1** range to the game.
`ElementHandler` multiplies by 100 before `setVolume()` calls and divides by
100 after `getVolume()` calls; `lastVolume` is stored in 0..1 units. This is a
behavior change from v1 (which passed the value through unchanged). Games
targeting v1 that used the 0..100 range must update their `SetVolume` calls.

### Quality levels (confirmed 2026-06-22)

`player.player.core.activePlayback.levels` is an array of
`{ level, width, height, bitrate, codec }` objects — observed 4 levels
(360p / 468p / 720p / 1080p with bitrates). `activePlayback.currentLevel` is
readable/writable; `-1` means ABR/auto.

**No quality-change event exists at the wrapper level.** The `PlayerEvent` enum
has no quality or level entry (confirmed above). Quality state is polled on each
`TimeUpdate` (and seeded on `Ready`), posting `currentQuality` to the runtime
only when the level index actually changes (suppressed otherwise). Exposed via
the `SetQuality` / `GetCurrentQuality` / `GetQualityCount` ACEs. An
`OnQualityChanged` trigger is not feasible without reaching into Clappr core
directly.

### Chrome (control bar)

The built-in control bar is managed by the `media_control` Clappr plugin. It
exposes `enable()` / `disable()` methods that toggle the UI without tearing
down and rebuilding the player. The plugin retrieves it via
`core.getPlugin('media_control')` (falling back to scanning `core.plugins`).

This is wired to an `enableChrome` property (default ON) and the
`SetEnableChrome` / `GetEnableChrome` ACEs. A chrome change while a video is
playing takes effect immediately (live toggle via `ApplyChrome()`); a chrome
change when no video is loaded is applied on the next `Ready` event after
construction.

### Multi-source failover

Multiple entries in the Player `sources` array trigger automatic failover via
the `SourceController` plugin (registered at module load). The plugin resolves
all URLs concurrently (primary failure is fatal; fallback resolution failures
are swallowed with a warning). Exposed via the `SetFallbackURLs` ACE. A change
to the fallback-URL list triggers a player rebuild (handled by `NeedsRebuild`).

### Resize

The player is resized automatically by a `ResizeObserver` on the container
element. An explicit `Resize` action is also exposed as an ACE for cases where
the game needs to trigger a resize programmatically.

### Subtitles (the tricky one)

GCore HLS manifests carry the subtitle renditions in-manifest
(`#EXT-X-MEDIA:TYPE=SUBTITLES,…,LANGUAGE="en"`). Getting them to render took
three non-obvious pieces — all encoded in `ElementHandler.ApplySubtitles()` and
demonstrated by [`../test/player-test.html`](../test/player-test.html):

1. **Reach the real playback.** Tracks and selection live on the inner Clappr
   player: `player.player.core.activePlayback`. It exposes `closedCaptionsTracks`
   and `setTextTrack(id)`. The wrapper's `player.closedCaptionsTrackId` is a
   **no-op** on the HLS backend.

   **Track shape (confirmed 2026-06-22):** each entry has `id`, `language`, and
   `name` (e.g. `{ id: 0, language: "en", name: "English" }`). The `label`
   field is **not present** (was undefined in all 7 observed tracks). The plugin
   matches by `language` then `name`, which is correct. Non-Latin display names
   (`ja`, `zh`) rely on the `language` field. With a real GCore VOD stream and
   no `?sub_lang=` query param, all 7 subtitle renditions (en/de/fr/pt/es/ja/zh)
   are already present in `closedCaptionsTracks` and `<video>.textTracks`
   (length 7) — the legacy `?sub_lang=` query param is unnecessary for
   in-account content.
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

### Confirmed working

Verified in a Construct 3 preview: playback, embed-URL → manifest resolution,
container sizing/resize, ready-state, mute/volume persistence across videos,
and subtitle selection/rendering.

The following were additionally confirmed 2026-06-22 against
`@gcorevideo/player` v2 (`player.gvideo.co/v2/assets/latest/index.js`) with a
real GCore VOD stream (master.m3u8):

- `TimeUpdate` payload is `{ current, total }` — plugin destructuring correct.
- `Error` payload includes `.message`, `.code`, `.level`, `.origin`, `.scope`,
  `.description`, `.UI.message` — `err.message` reliably present.
- In-manifest subtitle tracks (7 renditions on test stream) are exposed without
  any `?sub_lang=` query param; track shape is `{ id, language, name }` (no
  `label` field).
- Full `PlayerEvent` enum has exactly 11 keys (listed above); no quality event.
- `activePlayback.levels` and `activePlayback.currentLevel` work as described;
  `-1` = ABR.
- Chrome/UI plugin export names confirmed (BottomGear, Spinner, MediaControl,
  ErrorScreen, LevelSelector, QualityLevels, ClosedCaptions, Subtitles,
  DvrControls, AudioTracks, AudioSelector, SeekTime, Thumbnails,
  PictureInPicture, PlaybackRate, Poster, Logo, Share, ContextMenu,
  ClickToPause, and more).
- Volume wrapping (A3): `setVolume(0.5)` without wrapping → `<video>.volume`
  0.005 (0.5%). With the 0..1 → 0..100 conversion in place, `SetVolume(0.5)` →
  `player.setVolume(50)` → `<video>.volume` 0.5 — correct.
- Quality polling: `activePlayback.currentLevel` and `activePlayback.levels`
  accessible; initial level reported on `Ready`, change-suppressed polling on
  `TimeUpdate` working.
- Chrome live-toggle: `core.getPlugin('media_control')` returns the plugin;
  `enable()`/`disable()` take effect without a player rebuild.

### Known bugs / caveats

- **Error event fires repeatedly:** `OnError` can re-trigger many times for a
  single bad stream URL (one per hls.js retry).

### Implemented but pending live-stream / asset verification

The following features have code shipped in v2.0.0.0 but have not yet been
verified against the specific stream types they target. Code comments in
`ElementHandler.ts` reference this section (A-numbers below).

**A5 — Low latency (`noLowLatency`):**
For LIVE streams the low-latency choice is the **manifest path**, not just a
player flag. GCore serves a live stream (`<client>.gvideo.io/<id>`) as:
- low-latency (default): `cmaf/<id>/master.m3u8` (HLS / CMAF)
- non-low-latency: `mpegts/<id>/master_mpegts.m3u8` (HLS / MPEG-TS)
- DASH (low-latency): `cmaf/<id>/index.mpd`

`ResolveManifest` selects **cmaf vs mpegts** from `noLowLatency` when resolving a
`streams/` embed URL (a change rebuilds the player). As a secondary safeguard for
a *direct* CMAF manifest URL (which can't be re-pathed),
`playback.hlsjsConfig.lowLatencyMode = false` is also set when `noLowLatency` is
true. VOD is served from `videos/<id>/master.m3u8` (low-latency N/A). The
`playbackType` / `priorityTransport` config keys were evaluated but not used. The
plugin defaults to **HLS**; DASH (`index.mpd`) is available but not selected.

**A6 — DVR window (`enableDvr`, `GetSeekableStart` / `GetSeekableEnd`):**
`enableDvr` sets `config.playbackType = "dvr"` at construction time, which
enables the player's DVR seek window. `IsDVR` reads `activePlayback.dvrEnabled`
(public boolean, false on VOD — confirmed). The seekable window boundaries
(`GetSeekableStart` / `GetSeekableEnd`) are read from **private fields**
`_playableRegionStartTime` and `_playableRegionDuration` — no public accessor
exists for the seekable range (`seekableRange`, `getSeekable`, `getSeekableRange`,
`dvrInUse` all absent). These private-field reads are **fragile and unverified
against a real live/DVR stream**; they may break on a future player update.

**A4 / D4 — Side-loaded subtitles (`AddSubtitleSource`): VERIFIED.**
External subtitle tracks are injected via `playback.externalTracks` at
construction time with the shape `{ kind: "subtitles", src, label, lang }` (the
`lang` field is correct — verified against a real external `.vtt`). Clappr's
HTML5 playback wires them via `_setupExternalTracks()`.

**Key finding:** an external track appears **only in the native
`<video>.textTracks`** — it does **NOT** appear in hls.js
`closedCaptionsTracks`. So the `setTextTrack(id)` path (which drives in-manifest
tracks) can never select it. External tracks are selected by setting the native
`textTrack.mode = "showing"` directly (see `ApplySubtitles` /
`SetExternalTrackMode`). Verified: with the matching native track set to
`showing`, its cues load and render (`activeCues` populated at the cue's
timestamp). Use a language tag **distinct** from the in-manifest ones (e.g.
`"en-ext"`) so the external track isn't shadowed by an in-manifest track of the
same language. In-manifest subtitles (no `?sub_lang=`) remain verified (7 tracks
on the test stream), selected via `setTextTrack`.
