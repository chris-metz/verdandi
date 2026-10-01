# Verdandi for macOS

An experiment: Verdandi as a native macOS app in SwiftUI, with Liquid Glass,
without Node or Electron. It reads GitHub through `gh`, as the Electron app
does, and reads and writes the same `settings.json`, so both show the same
tracked repositories and views. Don't run both at once.

Needs macOS 26 or later and Xcode 26 or later.

## Build and run

```sh
cd apps/macos
scripts/build-app.sh          # build/Verdandi.app (debug); add `release` to optimize
open build/Verdandi.app
swift test                    # unit tests; VERDANDI_LIVE=1 also reads real GitHub
```

Set `VERDANDI_HOME` to use another profile than your own, e.g. the one in
`scripts/dev-home/` (copy it first: the app writes to it).

## Screenshots

`scripts/snap.sh out.png [seconds]` launches the built app, waits, saves its
window and quits it. The `VERDANDI_*` launch options in
`Sources/Verdandi/App/Debug.swift` open a state without clicking, e.g.

```sh
VERDANDI_HOME=/tmp/vh VERDANDI_APPEARANCE=dark VERDANDI_SELECT=repo:chris-metz/verdandi \
  VERDANDI_ISSUE='chris-metz/verdandi#8' scripts/snap.sh /tmp/issue-dark.png 8
```

macOS does not let the app take focus from the app you are using, so the
window usually shows as an inactive one.

## Layout

- `Sources/VerdandiCore`: what does not draw. `GitHubClient` (every read of
  GitHub, through `gh api`), `Settings` (settings.json), `RunCommand`,
  `GhLocator`, the models.
- `Sources/Verdandi`: the SwiftUI app, one folder per feature.
  - `App/`: `AppModel` (setup, settings, navigation, shared state),
    `IssueStore` (every issue read, by node ID), the window, launch options.
  - `Sidebar/`, `Lists/`, `IssuePage/`, `Picker/`, `SavedViews/`, `Setup/`,
    `Settings/`, `Shell/`: the features, each with its own store.
  - `Shared/`: small views several features use.

The app's code runs on the main actor by default; `VerdandiCore` is plain
`Sendable` values and async functions.
