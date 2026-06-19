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

const player = new Player({
  autoPlay: true,
  mute: true, // muted autoplay avoids browser autoplay blocks; game unmutes
  sources: [{ source: url, mimeType }],
})
player.attachTo(containerDiv)
```

`mimeType` is derived from the URL path: `.mpd` → `application/dash+xml`,
otherwise `application/x-mpegurl` (HLS). Progressive/direct-file sources are not
supported.

### Events — `player.on(PlayerEvent.X, handler)`

`PlayerEvent` values used: `Play` `"play"`, `Pause` `"pause"`, `Ended`
`"ended"`, `Error` `"error"`, `Ready` `"ready"`, `TimeUpdate` `"timeupdate"`,
`VolumeUpdate` `"volumeupdate"` (also `Seek`, `Stop`, `Fullscreen`, `Resize`).

### Control methods — synchronous

`play()`, `pause()`, `seek(seconds)`, `setVolume(0..1)`, `getVolume()`,
`getDuration()`, `mute()`, `unmute()`, `isMuted()`, `destroy()`. Unlike the old
API these return values directly (no callbacks).

## Old API (removed — for historical context)

The pre-v2 integration used `https://vplatform.gvideo.co/_players/latest/gplayerAPI.min.js`,
accessed via the `globalThis.GcorePlayer.gplayerAPI` global, constructed against
an `<iframe>` whose `src` was the video URL. Events were `.on(name, …)` and
commands were `.method({name, params, callback})` (async via callback). This
endpoint is gone; that is what the v2 port replaced.

## Runtime-verification items (assumptions to confirm in a C3 preview)

These were assumed from docs during the v2 port and not yet confirmed against a
live player:

- `TimeUpdate` payload shape is `{ current, total }`; `Error` payload exposes
  `.message`.
- `setVolume` expects a `0..1` range (the ACE value is passed through as-is).
- The legacy `?sub_lang=` / `no_low_latency` URL query params are still honored
  by the v2 manifest endpoint (kept as-is; proper Subtitles-plugin support is a
  possible follow-up).
