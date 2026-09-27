# Verdandi

A read-only, keyboard-first desktop client for GitHub issues across many repositories, focused on how issues relate: sub-issue hierarchies and blocking relationships that cross repository boundaries. Vocabulary is in [`CONTEXT.md`](CONTEXT.md), decisions in [`docs/adr/`](docs/adr/).

## Prerequisites

- [Node.js](https://nodejs.org/) 24, the Node major bundled with the Electron version in use.
- [pnpm](https://pnpm.io/) 11; the exact version is pinned in `package.json` under `packageManager`.
- [GitHub CLI](https://cli.github.com/) (`gh`) installed, on your `PATH` and signed in (`gh auth login`). Verdandi reads GitHub only through `gh` and never asks it for your token.

With [mise](https://mise.jdx.dev/), `mise install` sets up the Node and pnpm versions from `mise.toml`.

## Run from source

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts the desktop app. The first run downloads the Electron binary. The window reloads when the renderer changes, and the app restarts when the main process or preload changes.

Set `VERDANDI_HOME` to keep all of Verdandi's files under one directory, e.g. for a throwaway profile.

## Check before pushing

```sh
pnpm check
```

It runs typecheck, lint, format check and tests. `pnpm format` fixes formatting.

## Layout

- `packages/core`: all domain behaviour, as plain TypeScript for Node. It never depends on Electron, React or the DOM, so a later terminal UI can reuse it.
- `apps/desktop`: the Electron app. The main process runs the core in-process and only wires it to IPC; preload exposes it to the React renderer, which reaches the core only through the typed contract in `packages/core/src/contract.ts`.
