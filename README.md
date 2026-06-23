# Genvid Construct 3 Addon Template

## Template Setup

1. Replace the name of the module `c3addon-template` with your own.
2. Replace all occurences of `Genvidtech_GCoreVideoPlugin` with the plugin's ID.

## To use

See [`docs/usage.md`](docs/usage.md) for a task-oriented guide covering video
loading, subtitles, quality levels, DVR, the player control bar, and v2.0.0
breaking changes.

## To develop

```bash
npx http-server src --cors
```

Because of the restricted CSP in Construct3, make sure to use http://localhost:8080/addon.json instead of 127.0.0.1.

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
