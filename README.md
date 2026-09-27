# Verdandi

A read-only, keyboard-first desktop client for GitHub issues across many repositories, focused on how issues relate: sub-issue hierarchies and blocking relationships that cross repository boundaries. Vocabulary is in [`CONTEXT.md`](CONTEXT.md), decisions in [`docs/adr/`](docs/adr/).

## Prerequisites

- [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/) in the versions pinned in `mise.toml`. Node stays on the major bundled with the Electron version in use.
- [GitHub CLI](https://cli.github.com/) (`gh`) installed, on your `PATH` and signed in (`gh auth login`). Verdandi reads GitHub only through `gh` and never asks it for your token.

With [mise](https://mise.jdx.dev/), `mise install` sets up Node and pnpm.

## Run from source

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts the desktop app. The first run downloads the Electron binary. The window reloads when the renderer changes, and the app restarts when the main process or preload changes.

Set `VERDANDI_HOME` to keep all of Verdandi's files under one directory, e.g. for a throwaway profile.

## Track repositories

Until Verdandi can add repositories itself, list them by hand in `settings.json` in the user data directory: `~/Library/Application Support/Verdandi/` on macOS, `%APPDATA%\Verdandi\` on Windows, `$XDG_DATA_HOME/verdandi/` (by default `~/.local/share/verdandi/`) on Linux, or `VERDANDI_HOME` when it is set.

```json
{
  "version": 1,
  "repositories": [{ "name": "owner/repo" }],
  "views": []
}
```

The sidebar lists them in this order. Verdandi reads the file when its window opens.

## Check before pushing

```sh
pnpm check
```

It runs typecheck, lint, format check and tests. `pnpm format` fixes formatting.

## Layout

- `packages/core`: all domain behaviour, as plain TypeScript for Node. It never depends on Electron, React or the DOM, so a later terminal UI can reuse it.
- `apps/desktop`: the Electron app. The main process runs the core in-process and only wires it to IPC; preload exposes it to the React renderer, which reaches the core only through the typed contract in `packages/core/src/contract.ts`.
