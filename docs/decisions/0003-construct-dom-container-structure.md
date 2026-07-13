# 0003. Two-`<div>` container structure for the Construct DOM element

- **Status:** Accepted
- **Date:** 2026-07-13
- **Issue:** [genvid-holdings/c3addon-gcore-video-plugin#11](https://github.com/genvid-holdings/c3addon-gcore-video-plugin/issues/11)

## Context

The v2 plugin (ADR-0001) hands Construct a bare, initially-empty `<div>` as its
HTML-object element (`CreateElement` in `src/c3runtime/domSide.ts`). The
`@gcorevideo/player` injects its `<video>` only asynchronously, when a video
loads (`player.attachTo(...)` inside `ElementHandler.CreatePlayer`), so at
Construct's layout-build time the container is empty.

Construct's [HTML-layers](https://www.construct.net/en/make-games/manuals/construct-3/tips-and-guides/html-layers)
system interleaves canvas layers and HTML objects into a stack of `<canvas>`
elements plus `<div>` wrappers. Its per-HTML-layer wrapper indexing desyncs
when the HTML-object element is an *empty* `<div>` at build time, so
`Set layer (in)visible` toggles `display:none` on the wrong wrapper — in the
Burbank consumer, a covering layer that should hide stays visible over the
video.

The pre-v2 plugin used an `<iframe>` element directly (it loaded the GCore
embed page via the iframe `src`), a non-empty replaced element that kept the
wrapper aligned. v2 cannot revert to that: the new library runs in the host
document and injects `<video>` via `player.attachTo(element)`, which needs a
same-document container — the player cannot attach into a separate iframe
document.

## Decision

`CreateElement` hands Construct a two-`<div>` structure. The outer `<div>` is
the element Construct positions/manages; it is `overflow:hidden`
(self-contained) and non-empty from creation because it always holds the
inner container as a child. The inner `<div>` tracks the outer box
(`position:absolute`, inset 0) and is the sole `player.attachTo(...)` target.

`ElementHandler` keeps `element` (outer) for sizing, event handling and
resize-observation, and adds `playerContainer` (inner) purely as the attach
target. `querySelector("video")` still resolves because the `<video>` is a
descendant of the outer element.

This fits the existing editor/runtime/DOM architecture (see
[architecture.md](../architecture.md)) without adding a new seam: the
container shape lives entirely inside `domSide.ts`/`ElementHandler.ts`, the
two files already responsible for the GCore-facing DOM element.

## Compromise

### Rejected: a persistent inert `<iframe>` sentinel inside the container

The issue originally proposed nesting a persistent inert `<iframe>` sentinel
inside the container to keep it non-empty. Rejected: the sentinel would live
in the *same* div the player attaches into, so if `attachTo()` ever clears its
target's children it would wipe the sentinel; it also introduces a separate
`about:blank` document for no benefit. The dedicated inner container is
strictly more robust — whatever the player does to its own node, the outer
stays non-empty.

### Rejected: reverting to an `<iframe>` element (v1 approach)

Impossible, as above — the player needs a same-document attach node and
cannot attach into a separate iframe document.

### Rejected: consumer-side HTML-layer restructuring

Per the Construct manual, only top-level layers can be HTML layers, and the
covering content is on canvas layers batched into a shared `<canvas>`, so an
in-project spacer/sub-layer cannot create the needed boundary. Verified
empirically in Burbank.

## Consequences

- The element Construct receives is non-empty and self-contained from
  creation regardless of player state; this keeps HTML-layers wrapper
  indexing aligned. **Constraint for future changes:** whatever
  `CreateElement` returns must stay non-empty/self-contained — do not revert
  to a bare empty `<div>`.
- Subtitle (`querySelector("video")`) and resize paths are unaffected
  (verified in the browser harness via Playwright: `attachTo()` into the
  nested inner container injects a working `<video>`, the outer resolves it,
  video fills the box).
- This class of HTML-layer bug reproduces only inside Construct;
  `test/player-test.html` has no HTML-layer bookkeeping to break, so it
  verifies the player but not the visibility fix — that must be checked in a
  real Construct project.
- **Partial fix:** shipped as 2.1.1.0, this only partly resolves #11. Testing
  in Construct surfaced a residual, unrelated Construct HTML-layer bug (a
  separate C3-side cause, not the empty container), accepted for now; #11
  remains open to track the remainder.
