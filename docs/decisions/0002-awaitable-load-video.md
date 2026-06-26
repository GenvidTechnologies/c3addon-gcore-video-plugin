# 0002. Awaitable Load Video with resolve-at-Ready contract

- **Status:** Accepted
- **Date:** 2026-06-26
- **Issue:** [genvid-holdings/c3addon-gcore-video-plugin#7](https://github.com/genvid-holdings/c3addon-gcore-video-plugin/issues/7)

## Context

The **Load Video** action (`set-url`) was fire-and-forget. Post-load settings
(subtitles, seek position, quality level) placed on the next action line raced
the async manifest fetch and were silently dropped on a cold manifest — a
concrete regression that blocked Burbank v2 integration (burbank#118).

Two existing ACEs addressed the symptom only partially:

- **Is ready** (condition) lets the event sheet poll player state, but offers no
  event-driven notification of load completion and no general readiness contract.
- **On subtitles available** (trigger) fires when the subtitle track list is
  first known, but is subtitle-only and says nothing about quality levels or the
  seekable range.

Neither gave developers a single seam where post-load initialization could be
issued reliably.

## Decision

### 1. isAsync on the existing `set-url` action — back-compat under ADR-0001

Making `set-url` awaitable adds `isAsync: true` to the existing ACE definition.
Under ADR-0001's binding-freeze, the ACE id, scriptName, and parameter order are
all unchanged; only execution semantics change. This is additive and
back-compatible: Construct runs all actions inside a promise, so an awaitable
action coexists transparently with existing event sheets that do not await it.

The awaitable Load Video complements — it does not replace — the existing
`Is ready` condition and the `On state changed` / `On subtitles available`
triggers; it gives developers one more choice. The same pattern already shipped
in this codebase with `add-project-subtitle-source` (PR #5).

A new parallel `load-video-async` action was considered and rejected (see
Compromise).

### 2. Resolve at the `Ready` event, not at "playback-stable"

The promise resolves when the GCore player emits its `Ready` event. `Ready`
means: URL setup complete — manifest parsed, player constructed, quality levels
populated, seekable range known. It is explicitly playback-independent; the
player may still be paused or not yet playing.

Empirical data from `test/probe-timing.js` (cold-manifest run):

| Milestone | Offset |
|---|---|
| `Ready` event | +1.2 s |
| First `TimeUpdate` | +2.2 s |
| In-manifest CC tracks populated | ~+1.5 s (roughly +0.3 s after Ready) |

A seek issued immediately after `Ready` lands precisely. Quality levels are
available at `Ready`. These timings confirm that `Ready` is the correct
resolution point for all three post-load use cases (seek, quality, subtitles).

### 3. Separation of load-readiness from subtitle-display-settle

The `~2 s playbackStable` gate used by subtitle-display is a separate concern:
hls.js needs a short window of played-through time before subtitle cues render
reliably. This is a display-settle requirement, not a readiness requirement.

Folding the `~2 s` gate into the `Load Video` await contract would add a
needless delay to every await — including callers that only care about seek or
quality and never touch subtitles. The deferred-apply path already handles the
subtitle-display case: a `Set Subtitles` issued right after `Ready` is stored in
`subtitleLang` and re-applied by the `TimeUpdate` handler once the
`playbackStable` flag is set (~2 s of played-through time). R1 ("subtitles
active once playing") is delivered without the load promise blocking.

### 4. Settle-on-all-outcomes with timeout; never reject

The promise resolves (never rejects) on every terminal outcome:

| Outcome | Behavior |
|---|---|
| `Ready` | Resolves immediately. |
| Primary load error | Resolves; use the `On error` trigger to branch on failure. |
| 15 s timeout | Resolves; treated as "done", not a failure. |
| Supersession by a newer Load Video | The older promise resolves immediately; the late `Ready` from the stale player is a no-op. |

A per-load generation counter (`loadGen`) is incremented on each `Load Video`
call. Each `_settleLoadPromise` call carries the generation at which it was
issued; a stale generation is silently discarded. This makes supersession O(1)
and race-free.

Using `On error` + `Is ready` for success/failure branching reuses existing
ACEs and keeps the action contract to one outcome: "the load attempt is done."

### 5. C6 save/load: synchronous restore path is unchanged

`_loadFromJson` restores plugin state by calling `_updateElementState()`
synchronously. The in-flight load promise is ephemeral and is never serialized
or restored. Save/load behavior is unaffected by this change.

## Compromise

### Rejected: a new parallel `load-video-async` action

Adding a dedicated async action alongside the existing `set-url` would surface
the capability for new event sheets but leave all existing sheets with the old
fire-and-forget behavior. Developers would need to manually migrate to the new
action to gain the benefit. Making `set-url` itself awaitable is back-compatible
under ADR-0001 (id/params unchanged) and means every existing sheet
automatically gains the option to await without any migration.

### Rejected: resolving at "playback-stable" (~2 s after first TimeUpdate)

Waiting for playback stability before resolving would add a ~2 s delay to every
awaited Load Video, even for callers that only care about seek or quality and
have no interest in subtitle display. It also conflates two distinct concerns:
manifest-and-player readiness (a loading concern) and subtitle-cue rendering
stability (a display concern). The deferred-apply path already solves the
subtitle-display case without any change to the load contract.

### Rejected: buffered-post-load-state without an awaitable

A purely buffering approach — capturing post-load settings and replaying them
after the player is ready — was also considered. Subtitle buffering already
exists and covers the subtitle case. However, it does not generalize: seek and
quality level selection require knowing the seekable range and level count at
the time of application, not the value at the time of the call. A per-setting
deferred-apply path for each new ACE pushes lifecycle complexity onto every
future maintainer. A single ready contract (`OnLoadVideo` / `_settleLoadPromise`
+ `loadGen` in `ElementHandler.ts`) solves the whole class.

## Consequences

- Post-load settings (subtitles, seek, quality) issued on the action line after
  Load Video reliably apply; the manifest-race bug class is closed.
- Existing event sheets that do not await Load Video are unaffected.
- The event sheet never hangs: the promise always settles (Ready, error, timeout,
  or supersession within 15 s at most).
- Maintainers gain a reusable readiness seam — `OnLoadVideo` /
  `_settleLoadPromise` + `loadGen` in `ElementHandler.ts` — for any future
  ACE that needs to act at load completion.
- `test/probe-timing.js` documents the empirical Ready-event timeline and serves
  as a regression check if the GCore player version changes.
