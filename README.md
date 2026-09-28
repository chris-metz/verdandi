# Verdandi

A read-only, keyboard-first desktop client for GitHub issues across many repositories, focused on how issues relate: sub-issue hierarchies and blocking relationships that cross repository boundaries. Vocabulary is in [`CONTEXT.md`](CONTEXT.md), decisions in [`docs/adr/`](docs/adr/).

## Prerequisites

- [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/) in the versions pinned in `mise.toml`. Node stays on the major bundled with the Electron version in use.
- [GitHub CLI](https://cli.github.com/) (`gh`) 2.81.0 or later, signed in to github.com (`gh auth login`). Verdandi reads GitHub only through `gh` and never asks it for your token.

With [mise](https://mise.jdx.dev/), `mise install` sets up Node and pnpm.

## Run from source

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts the desktop app. The first run downloads the Electron binary. The window reloads when the renderer changes, and the app restarts when the main process or preload changes.

Set `VERDANDI_HOME` to keep all of Verdandi's files under one directory, e.g. for a throwaway profile.

## Build a local app

```sh
pnpm package
```

It builds an unsigned app for the operating system you run it on, in `apps/desktop/dist/`, which starts by double-click:

- macOS: `mac-arm64/Verdandi.app` (`mac/Verdandi.app` on Intel). Drag it to Applications if you like. It is unsigned, meant for the Mac that built it.
- Windows: `win-unpacked/Verdandi.exe`.
- Linux: `linux-unpacked/verdandi`.

There are no installers, signing or updates yet. The first build downloads Electron.

## GitHub CLI

Verdandi looks for `gh` in this order:

1. where you chose it with **Choose gh executable…**, as long as it still works there;
2. on `PATH`;
3. where installers and package managers usually put it, such as `/opt/homebrew/bin` and `/usr/local/bin` on macOS, `/usr/bin`, `/home/linuxbrew/.linuxbrew/bin` and `/snap/bin` on Linux, and `C:\Program Files\GitHub CLI` on Windows.

The last step matters for an app started from Finder, the Start menu or a desktop entry: those don't pass on your shell's `PATH`. If Verdandi can't find `gh`, or `gh` isn't signed in, a setup dialog covers the app until it works, with **Check again** once you've fixed it in a terminal. Verdandi never installs `gh` or signs in for you. If `gh` works in your terminal but Verdandi doesn't find it, run `command -v gh` (`where.exe gh` on Windows) and choose that file. Verdandi remembers the choice on this machine only, in `state.json` in its machine-local folder (`~/Library/Application Support/Verdandi/desktop/` on macOS, `%LOCALAPPDATA%\Verdandi\desktop\` on Windows, `$XDG_STATE_HOME/verdandi/desktop/` on Linux, or `desktop/` under `VERDANDI_HOME`).

When `GH_TOKEN` or `GITHUB_TOKEN` is set where Verdandi starts, `gh` uses that token instead of the account it has stored, and the sidebar names the variable. Switching accounts with `gh auth switch` doesn't change that: change the variable and restart Verdandi.

## Track repositories

Until Verdandi can add repositories itself, list them by hand in `settings.json` in the user data directory: `~/Library/Application Support/Verdandi/` on macOS, `%APPDATA%\Verdandi\` on Windows, `$XDG_DATA_HOME/verdandi/` (by default `~/.local/share/verdandi/`) on Linux, or `VERDANDI_HOME` when it is set.

```json
{
  "version": 1,
  "repositories": [{ "name": "owner/repo" }],
  "views": []
}
```

The sidebar follows the file order. Drag an entry within its section, or press ⌥/Alt+↑/↓ on the selected entry, to reorder and save it. All stays first.

**File → Show Settings File** opens the folder. Hand edits appear live. Settings use strict JSON: unknown fields and invalid values are reported with their location. While the file is broken or unreadable, Verdandi keeps its last valid sidebar and disables changes. **Reload** checks again; **Reset** preserves the original as `settings.json.broken-<timestamp>` and starts empty.

Files from a newer version are read-only until Verdandi is updated. Older files are migrated on the next change, with a one-time `settings.json.backup-v<version>` backup.

## Check before pushing

```sh
pnpm check
```

It runs typecheck, lint, format check and tests. `pnpm format` fixes formatting.

## Layout

- `packages/core`: all domain behaviour, as plain TypeScript for Node. It never depends on Electron, React or the DOM, so a later terminal UI can reuse it.
- `apps/desktop`: the Electron app. The main process runs the core in-process and only wires it to IPC; preload exposes it to the React renderer, which reaches the core only through the typed contract in `packages/core/src/contract.ts`.
