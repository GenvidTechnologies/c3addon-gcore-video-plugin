# 0001. Additive v2 API expansion with construction-time rebuild discipline

- **Status:** Accepted
- **Date:** 2026-06-22
- **Issue:** [genvid-holdings/c3addon-gcore-video-plugin#1](https://github.com/genvid-holdings/c3addon-gcore-video-plugin/issues/1)

## Context

PR #3 ported the plugin to `@gcorevideo/player` v2 with minimal scope — enough
to restore the existing feature set under the new API. Issue #1 completes the
conversion by adding capabilities the v2 API makes available: low-latency config,
opt-in UI chrome, quality control, multi-source failover, DVR, an explicit resize
action, and API-injected subtitle sources.

Two hard constraints govern every addition:

1. **Back-compat surface.** The plugin has active consumers whose Construct 3
   projects bind ACEs by id, bind ACE parameters positionally, and persist plugin
   property values in save-game data by key. A rename, removal, or reordering
   breaks those projects silently at the Construct layer — not as a compile error.
2. **Editor/runtime/DOM separation.** All GCore coupling is isolated to
   `src/c3runtime/dom/ElementHandler.ts` via a generic message bridge (see
   [architecture.md](../architecture.md)). New capabilities must not leak GCore
   details into the runtime side.

## Decision

### 1. Additive-only ACE expansion

`PLUGIN_ID` is immutable. Existing ACE ids, property names, and ACE parameter
order are frozen. Every new capability is added as a new ACE or property — never
by renaming, removing, or reordering an existing one.

Concretely, multi-source failover becomes a new `SetFallbackURLs` action rather
than a 4th parameter on the existing `SetURL` action. Adding a parameter to
`SetURL` would shift all positional bindings in existing event sheets and break
existing projects.

### 2. Construction-time config and the rebuild-on-change discipline

The v2 `Player` accepts playback config, sources, plugin config, DVR settings,
and subtitle source config only at construction — `new Player(config)`. There are
no live setters for these fields. This means any toggle that affects construction
config must store its value on the plugin instance and trigger a full player
rebuild when it changes, following the precedent already established by `SetURL`.

The rebuild-on-change discipline distinguishes two categories of state:

- **Rebuild-affecting:** low-latency mode, UI chrome opt-in, DVR, subtitle
  sources, multi-source fallback URLs, and the source URL itself. Changing any of
  these tears down and reconstructs the player.
- **Live-mutable:** volume, mute, play/pause/seek, and in-manifest subtitle track
  selection. These call through to the running player without a rebuild.

### 3. Two refactor seams to keep rebuild discipline cheap

To prevent the rebuild path from becoming an ad-hoc tangle of conditionals as
fields accumulate, two seams are introduced inside `ElementHandler.ts`:

- `BuildPlayerConfig(manifestUrl)` assembles the full construction config from
  current instance fields. Each new rebuild-affecting toggle is a single spread
  into this config object.
- `NeedsRebuild(next)` centralizes the rebuild decision, comparing all
  rebuild-affecting fields of `next` against the currently running player config.
  It replaces the previous coarse URL-only gate.

These seams preserve the single-file isolation (`ElementHandler.ts`) while
keeping individual additions to one-liners.

### 4. Empirical-first verification

Player-internal assumptions — event payload shapes, volume units, DVR window API
shape, chrome plugin opt-in mechanism, quality level API, subtitle rendition
completeness — are verified by driving `test/player-test.html` via Playwright
against a real stream before writing production code. This is the project mandate
(see `CLAUDE.md`). Reading the minified bundle gives repeatedly-wrong answers;
running it settles questions in minutes. Several feature designs in issue #1 are
explicitly provisional until this verification completes.

## Compromise

### Rejected: extending `SetURL` with a fallback parameter

The obvious shortcut — adding a fallback-URL parameter to the existing `SetURL`
action — would break positional bindings in every existing project that uses
`SetURL`. Adding a dedicated `SetFallbackURLs` action costs one extra ACE
registration but preserves all existing event sheets.

### Rejected: live config mutation

If `@gcorevideo/player` v2 exposed live setters for playback config, a
rebuild-on-change pattern would be unnecessary overhead. It does not. There is no
supported path to mutate construction-time config on a running player instance.

### Rejected: per-instance chrome plugin registration

The UI chrome feature is implemented as a v2 player plugin. A per-instance
registration approach (register only when chrome is enabled for that instance)
was considered and rejected: `@gcorevideo/player` v2 plugin registration is
process-global and one-shot — registering the same plugin twice throws. Chrome is
therefore registered once globally at module load time and gated per-instance
via the player construction config (`ui: true/false`).

### Accepted cost: ACE additions ripple across ~8 files

Construct 3's plugin contract requires lockstep edits across several files
(`plugin.ts`, `actions.ts`/`conditions.ts`/`expressions.ts`, language strings,
`instance.ts` message handling, `ElementHandler.ts` implementation) for each new
ACE. This is an irreducible cost of the Construct architecture, not a local
design choice. Maintainers should expect 6–8 file touches per new action.

## Consequences

- New capabilities land without disturbing existing projects or save data.
- Toggling construction-time config causes a brief player teardown and
  reconstruction; this matches the existing `SetURL` behavior and is acceptable
  for configuration-time operations.
- The single-seam isolation (`ElementHandler.ts` as the only GCore-aware file)
  is preserved through the expansion.
- `BuildPlayerConfig` and `NeedsRebuild` are the two extension points
  maintainers need to know when adding future rebuild-affecting state.
- Features that depend on player-internal behavior (DVR API shape, subtitle
  rendition completeness, quality level API) carry a verification dependency on
  empirical testing before they can be considered complete.
