# Architecture

This add-on wraps the GCore video player as a Construct 3 plugin. Understanding
two boundaries is essential before changing anything — they are why player-API
migrations stay small.

## Editor side vs. game (runtime) side

Construct 3 plugins run code in two completely separate contexts:

| File / location | Context | Runs when |
|---|---|---|
| `src/plugin.ts` | **Editor side** | In the Construct 3 editor (and at export time). Declares the plugin, its properties, ACEs, script dependencies, and which runtime scripts to load. **Does not run in the game.** |
| `src/c3runtime/**` | **Game (runtime) side** | In the exported/previewed game. |

So a call like `this._info.AddRemoteScriptDependency(url, "module")` in
`plugin.ts` is a *declaration* made in the editor: it instructs Construct to
inject a `<script type="module" src=url>` into the **game** at runtime. The
actual use of that script happens on the game side.

## Runtime side: worker vs. DOM split

Within the game, the runtime is split again (Construct's "worker mode"):

- **Runtime side** (`instance.ts`, `actions.ts`, `conditions.ts`,
  `expressions.ts`, `main.ts`) may run in a Web Worker with **no DOM access**.
  It holds plugin state and exposes the ACEs the game author uses.
- **DOM side** (`dom/domSide.ts`, `dom/ElementHandler.ts`,
  `dom/ElementHandlerMap.ts`) runs in the main document and can touch the DOM.
  `plugin.ts` registers these via `SetDOMSideScripts([...])`.

The two halves communicate only through a **generic, API-agnostic message
bridge** (Construct's `DOMElementHandler` / `ISDKDOMInstanceBase`
`postMessage`-style helpers). The runtime side posts intent messages — `play`,
`pause`, `seek`, `setVolume`, `mute`, `unmute`, and element-state updates — and
receives back `state-changed` and `error` messages, which it folds into plugin
state (`playerState`, `audioState`, `currentVolume`, `duration`,
`currentPlaybackTime`). Note `instance.ts` treats `currentVolume === 0` as
muted.

The bridge has **two modes**:

- **Fire-and-forget (the default).** `_postToDOMElement(handler, data)` and
  `_updateElementState()` return `void`. Results, if any, flow back later as
  *uncorrelated* broadcast `state-changed` / `error` messages. This is how every
  intent above works.
- **Request/response (awaitable).** `_postToDOMElementAsync(handler, data)`
  returns a `Promise<JSONValue>` that resolves with whatever the matching DOM-side
  handler returns — and a DOM handler may return a `Promise`, so the runtime
  promise stays pending until the DOM side settles it. This is what makes
  `Load Video` (`set-url`, an `isAsync` ACE) awaitable: its `loadVideo` handler
  resolves only once the player reaches `Ready`. Register such a handler
  *separately* from the void-typed intent handlers so its returned promise is
  forwarded rather than swallowed. See
  [`decisions/0002-awaitable-load-video.md`](decisions/0002-awaitable-load-video.md).

  Making an existing action `isAsync` is back-compatible: Construct runs every
  action inside a promise, so event sheets that don't await it are unaffected.

## Why this matters: player-API coupling is isolated to one file

Because the bridge protocol is generic, **all coupling to the GCore player API
lives in `src/c3runtime/dom/ElementHandler.ts`**. The runtime side, the ACEs,
and the message bridge know nothing about GCore specifics.

Practical consequence: migrating to a new player API (as in the v2 port) is
almost entirely a rewrite of `ElementHandler.ts`, plus minor edits to the
container element in `domSide.ts`/`ElementHandlerMap.ts` (subject to the
constraint below) and the dependency declaration in `plugin.ts`. Resist the urge
to thread API details through the runtime side — keep `ElementHandler.ts` the
single seam.

See [`gcore-player-api.md`](gcore-player-api.md) for the current player API
surface used by `ElementHandler.ts`.

## The container element: outer wrapper + inner player container

`domSide.ts` `CreateElement` hands Construct a **two-`<div>` structure**, and the
shape is load-bearing:

- The **outer `<div>`** is the element Construct positions and manages as its HTML
  object. It is `overflow:hidden` (self-contained) and **non-empty from creation**
  — it always holds the inner container as a child.
- The **inner `<div>`** tracks the outer box (`position:absolute; inset 0`) and is
  what the GCore player attaches into (`player.attachTo(this.playerContainer)`).
  `ElementHandler` keeps `element` (outer) for sizing, event handling and
  resize-observation, and `playerContainer` (inner) purely as the attach target.

**Why not attach straight into the outer `<div>`?** Construct's
[HTML-layers](https://www.construct.net/en/make-games/manuals/construct-3/tips-and-guides/html-layers)
system interleaves canvas layers and HTML objects into a stack of `<canvas>`
elements plus `<div>` wrappers, and its per-HTML-layer wrapper indexing desyncs
when the HTML object's element is an **empty `<div>` at layout-build time** — so
`Set layer (in)visible` toggles `display:none` on the *wrong* wrapper. The v2
player only injects its `<video>` asynchronously (when a video loads), so a bare
container is empty at build time. Giving the player its own inner container keeps
the outer element non-empty regardless of what the player does to its own node,
which keeps the wrapper indexing aligned (GitHub #11).

**Constraint for future changes:** whatever element `CreateElement` returns to
Construct must be non-empty and self-contained from the moment it's created — do
not revert to handing Construct a bare, initially-empty `<div>`. Note this class
of HTML-layer bug reproduces **only inside Construct**; the
[`test/player-test.html`](../test/player-test.html) harness has no HTML-layer
bookkeeping to break, so it verifies the player attaches/plays but cannot verify
the visibility fix — that must be checked in a real Construct project.
