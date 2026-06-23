# Genvid Construct 3 Addon Template

## Template Setup

1. Replace the name of the module `c3addon-template` with your own.
2. Replace all occurences of `Genvidtech_GCoreVideoPlugin` with the plugin's ID.

## To use

See [`docs/usage.md`](docs/usage.md) for a task-oriented guide covering video
loading, subtitles, quality levels, DVR, the player control bar, and v2.0.0
breaking changes.

## To develop

Build first (`npm run build`, or `npm run watch` to rebuild on change), then
serve the compiled `dist/` as a Construct **developer addon**:

```bash
npm run devmode   # http-server dist --cors
```

Add it in Construct via *Menu → View → Addon Manager → Install new addon →
Developer mode* pointing at `http://localhost:8080/addon.json`. Because of the
restricted CSP in Construct 3, use `http://localhost:8080/...` (not `127.0.0.1`).

> **Picking up code changes:** a developer addon reloads when you reload the
> Construct tab after a rebuild. For a **packaged** (`.c3addon`) install, Construct
> does **not** hot-swap a rebuilt addon — you must **remove the addon and
> re-import** the freshly built `.c3addon` (and reload), even if the version
> number is unchanged. If a change "isn't taking effect," this is almost always
> why.

## To build

```bash
npm run all:{platform}
```

where platform is either `windows` or `linux`.

## CI/CD

- **CI** (`.github/workflows/ci.yml`): runs lint + build on every PR and on pushes to `main`. The built `.c3addon` is attached as a downloadable workflow artifact on each run.
- **Releases** (`.github/workflows/release.yml`): push a digit-first version tag to cut a release. The workflow builds and publishes `Genvidtech_GCoreVideoPlugin.c3addon` to the repo's GitHub Releases page.

```bash
git tag 1.1.0.0 && git push origin 1.1.0.0
```

To get a released build, download the `.c3addon` asset from the [GitHub Releases](../../releases) page.
