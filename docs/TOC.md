# Documentation Index

<!--
Genvid plugin skills consult this index to find your project's docs.
Each entry should be a one-line description. Add docs here as they are
written so the plugin's skills can discover them.
-->

- [architecture.md](architecture.md) — editor/runtime split, the DOM message bridge, and why player-API coupling is isolated to `ElementHandler.ts`.
- [gcore-player-api.md](gcore-player-api.md) — the GCore `@gcorevideo/player` v2 API surface used by the plugin (loading, events, methods, quality levels, chrome/control-bar, multi-source failover, subtitles); includes empirically-verified findings and pending items (low latency, DVR, side-loaded subtitles) awaiting a live/LL/DVR stream.

## Decision Records

- [decisions/0001-additive-v2-api-expansion.md](decisions/0001-additive-v2-api-expansion.md) — additive-only ACE expansion, construction-time rebuild discipline, and empirical verification mandate for the full v2 API conversion (issue #1).
