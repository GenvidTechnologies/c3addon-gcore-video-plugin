---
okf_version: "0.2"
---

<!--
Genvid plugin skills consult this index to find your project's docs
(it is the `docs/TOC.md` override target in `.gvt-agent.json`).
Each entry should be a one-line description. Add docs here as they are
written so the plugin's skills can discover them.
-->

# Wiki Index

This is the wiki's table of contents — every page under `wiki/`,
grouped under section headings, one line each. `/gvt-dev:maintain-wiki`
keeps this list current: a new page is added here when it's created, and
`lint` flags any page listed in **no** index — here, or in a
subdirectory's own `index.md`. Each entry's description is the linked
page's frontmatter `description`, so the index and the page can't drift.
See `schema.md` for the page format and maintenance rules.

## Knowledge

* [GCore Video Plugin — Usage Guide](usage.md) - User-facing guide for Construct 3 developers — loading videos, subtitles, quality, DVR, chrome, and v2.0.0 breaking changes.
* [Architecture](architecture.md) - Editor/runtime split, the DOM message bridge, and why player-API coupling is isolated to ElementHandler.ts.
* [GCore player API reference](gcore-player-api.md) - The GCore @gcorevideo/player v2 API surface used by the plugin (loading, events, methods, quality levels, chrome/control-bar, multi-source failover, subtitles), with empirically-verified findings and pending items (low latency, DVR, side-loaded subtitles) awaiting a live/LL/DVR stream.

## Process

* [Issue Triage Conventions](issue-triage.md) - Issue-backlog triage conventions (flat-label variant) consumed by /gvt-dev:triage-issues — category labels, required fields, duplicate/split/dependency policy, and gh mutation recipes.

## Decision Records

* [Decision Records](decisions/index.md) - Architecture and compromise decisions (ADRs 0001-0003).

## Schema

* [Wiki Maintenance Schema](schema.md) - The maintenance rules for this wiki — page format, create-vs-update lifecycle, raw/ immutability, staleness policy and the verb contract.
