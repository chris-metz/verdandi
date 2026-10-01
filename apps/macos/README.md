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

Until gh works, the window shows the setup screen, which says what is
missing and the commands that fix it in Terminal. Verdandi never installs gh
or signs in itself; it checks again as it becomes active again.

## Keys

| Keys       | Does                                              |
| ---------- | ------------------------------------------------- |
| ⌘K or ⌘L   | Go to Issue: `owner/name#12`, a link, or `#12`    |
| ⌘R         | Refresh what the window shows                     |
| ⌘N         | New View…                                         |
| ⇧⌘A        | Add Repository…                                   |
| ⌃⌘S        | Show or hide the sidebar                          |
| ⌘,         | Settings                                          |

Show Open and Show Closed are in the View menu.

## Settings

Settings (⌘,) has two tabs. General: the appearance, Automatic, Light or
Dark (the Electron app's themes are left out), and the history of Go to
Issue. GitHub: the account gh is signed in as, the gh in use, choosing
another, and where settings.json is.

What is not in settings.json stays on this Mac, in UserDefaults
(`io.github.chris-metz.verdandi.native`): `appearance`, `ghPath` (the gh the
user chose) and `recentIssues` (the last eight issues Go to Issue went to).

## Screenshots

`scripts/snap.sh out.png [seconds]` launches the built app, waits, saves its
window and quits it. The `VERDANDI_*` launch options in
`Sources/Verdandi/App/Debug.swift` open a state without clicking, e.g.

```sh
VERDANDI_HOME=/tmp/vh VERDANDI_APPEARANCE=dark VERDANDI_SELECT=repo:chris-metz/verdandi \
  VERDANDI_ISSUE='chris-metz/verdandi#8' scripts/snap.sh /tmp/issue-dark.png 8
VERDANDI_SETUP=gh-missing scripts/snap.sh /tmp/setup.png 3      # or signed-out, rejected, failed, checking
VERDANDI_SETTINGS=github scripts/snap.sh /tmp/settings.png 3    # the Settings window
VERDANDI_ABOUT=1 scripts/snap.sh /tmp/about.png 3               # the About window
VERDANDI_POPOVER=rate-limits VERDANDI_RATE_LIMITS=low scripts/snap.sh /tmp/limits.png 4
VERDANDI_SHEET=go-to-issue VERDANDI_GO_TO='#12' scripts/snap.sh /tmp/go.png 4
VERDANDI_NOTICES=sample scripts/snap.sh /tmp/notices.png 4
```

`VERDANDI_SETUP` shows a setup state without asking gh or changing it. It
saves the window that the options open: Settings, About, or the popover with
the window under it; `VERDANDI_SNAP=main|settings|about|popover` picks
another. `SNAP_REGION=1` saves the window's area of the screen instead, with
`SNAP_MARGIN` points around it.

A popover closes as soon as another app becomes active, so retry when a
snapshot of one comes out empty.

The window shows as an inactive one. `VERDANDI_ACTIVATE=1` brings it to the
front as the active window, when macOS lets it, which takes the keyboard
from the app you are typing in.

To try the menus without clicking, `VERDANDI_MENU='View/Show Closed'`
chooses an item a few seconds after launch, and `VERDANDI_MENU_FILE=out.txt`
writes the menu bar, each item with its shortcut and whether it is enabled.

## Layout

- `Sources/VerdandiCore`: what does not draw. `GitHubClient` (every read of
  GitHub, through `gh api`), `Settings` (settings.json), `RunCommand`,
  `GhLocator`, `IssueLocator` (an issue as typed), the models.
- `Sources/Verdandi`: the SwiftUI app, one folder per feature.
  - `App/`: `AppModel` (setup, settings, navigation, shared state),
    `IssueStore` (every issue read, by node ID), the window, launch options.
  - `Setup/`: the setup screen, until gh works.
  - `Settings/`: the Settings window and the appearance.
  - `Shell/`: what frames the features: the menus, Go to Issue, the
    rate-limit popover, the notices, About.
  - `Sidebar/`, `Lists/`, `IssuePage/`, `Picker/`, `SavedViews/`: the
    features, each with its own store.
  - `Shared/`: small views several features use.

The app's code runs on the main actor by default; `VerdandiCore` is plain
`Sendable` values and async functions.
