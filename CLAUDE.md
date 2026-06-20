@CONVENTIONS.md

# c3addon-gcore-video-player

<!--
Project context for Claude Code. The genvid plugin's skills read this
file for project-specific facts the plugin can't infer. The
@CONVENTIONS.md import above brings in the plugin's contract.
-->

Construct 3 add-on (plugin) wrapping the GCore video player for use inside
Construct 3 games. TypeScript source in `src/` compiles to `dist/` via `tsc`,
then `dist/` is zipped into a `.c3addon` package.

## Commands

- Lint: `npm run lint`
- Build: `npm run build` (compiles `src/` → `dist/`, then copies assets)
- Validate (lint + build): `npm run lint && npm run build`
- Package: `npm run all:windows` / `npm run all:linux` (lint + build + zip `.c3addon`)
- Dev server: `npm run devmode`

There is no automated test suite.

## Architecture

- `src/plugin.ts` is **editor-side** (runs in the Construct 3 editor / at export,
  not in the game); only `src/c3runtime/**` runs in the game.
- All GCore player-API coupling is isolated to `src/c3runtime/dom/ElementHandler.ts`;
  the runtime side talks to it through a generic message bridge.
- See [`docs/architecture.md`](docs/architecture.md) and
  [`docs/gcore-player-api.md`](docs/gcore-player-api.md).

## Debugging the player

This plugin wraps a complex third-party browser player (`@gcorevideo/player`, a
~3 MB Clappr/hls.js bundle). For anything player-internal — subtitles, sizing,
playback state, audio, timing — **debug empirically in a real browser** with
[`test/player-test.html`](test/player-test.html) (drive it headlessly via the
Playwright MCP, or `npx http-server` + a browser). Reverse-engineering the
minified bundle by reading it gives repeatedly-wrong answers; running it settles
in minutes what static analysis gets wrong over hours. Note the `Player` is a
thin wrapper — the real Clappr player (core, playback, tracks) is at
`player.player`. See `docs/gcore-player-api.md` for the gotchas.

## Commit Format

`<type> - <description>`, where `<type>` is one of `feat`, `fix`, or `chore`.

Examples:
- `feat - Remove SetIsSingleGlobal`
- `fix - Fix SecondEvents`
- `chore - Update README, clean up comment`

## Pull Request Format

Title typically mirrors the branch / ticket (e.g. `BUR-4919-no-low-latency`).
Body should summarize the change and how it was verified (lint + build, manual
test in Construct 3).

## Branching

- Base branch: `main`.
- Branch naming: `BUR-<ticket>-<kebab-description>` (e.g. `BUR-4919-no-low-latency`).
  Use `BUR-0000-...` when there is no associated ticket.
- Remote: GitHub (`genvid-holdings/c3addon-gcore-video-plugin`).
