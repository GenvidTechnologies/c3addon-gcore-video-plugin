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
container element type in `domSide.ts`/`ElementHandlerMap.ts` and the dependency
declaration in `plugin.ts`. Resist the urge to thread API details through the
runtime side — keep `ElementHandler.ts` the single seam.

See [`gcore-player-api.md`](gcore-player-api.md) for the current player API
surface used by `ElementHandler.ts`.
