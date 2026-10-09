# Verdandi for iPhone and iPad

Verdandi as a native app for iPhone and iPad, in SwiftUI with Liquid Glass, for iOS 26 and later. One app serves both: three columns on an iPad (sidebar, list, issue page), one after another on an iPhone.

It runs the same core as the desktop app, `packages/core`, unchanged, on JavaScriptCore. There is no second core to keep in step (the reason [ADR 0008](../../docs/adr/0008-go-on-with-the-electron-app-only.md) dropped the native macOS app).

## How it fits together

```
SwiftUI views (Verdandi/)                     the app: what the user sees
   │ AppModel: state the core pushed, where the user is
   ▼
VerdandiKit.Core: the contract as async Swift functions + an event stream
   │ JSON through JavaScriptCore
   ▼
core.js = packages/core + apps/ios/host        the desktop app's core, as is
   │ runs "gh", which host/http-gh.ts answers
   ▼
GitHubAPI (Swift): HTTPS to api.github.com with the token from the Keychain
```

- `host/` (TypeScript) bundles the core for JavaScriptCore. The core still runs `gh`; `http-gh.ts` answers `gh --version`, `gh auth status` and `gh api` over HTTPS instead, so the core's `gh` adapter reads its answers as it reads gh's. Node's file system, paths, hashing and timers are stand-ins in `host/shims/` and `host/polyfills.ts`, answered by the app through `globalThis.__native`. `scripts/bundle.mjs` bundles it into `Verdandi/Resources/core.js`; Xcode runs it before each build.
- `VerdandiKit/` (Swift package): `CoreRuntime` runs `core.js` on one queue and answers the host; `Core` is the contract (`packages/core/src/contract.ts`) as typed async functions and a stream of `CoreEvent`s; `Contract/` holds the contract's types under the same names (`Label` is `IssueLabel`). `BlockingMap/` lays out the issue page's blocking map: where its cards, ends and arrows go, pure logic with its tests. `GitHubAPI` sends the core's requests with the token; the core never sees it. `Credentials` keeps the token in the Keychain, on this device only, or takes `GH_TOKEN` from the environment for development.
- `Verdandi/` (the app): `App/AppModel.swift` keeps what the core pushed (lists, views, pages, sidebar, setup, rate limits, config) and where the user is, and tells the core what is on screen as the user moves (`openShown`). Each feature has its folder: `Sidebar/`, `Lists/`, `IssuePage/`, `Picker/`, `SavedViews/`, `Settings/`, `Setup/`, `Shell/`. `Design/` holds the palette and the small views every feature shares.

The core's files (`settings.json`, `config.toml`, `desktop/state.json`) live in the app's Application Support folder, as `VERDANDI_HOME` keeps them on the desktop.

## Build and run

Needs Xcode 26 or later, XcodeGen (`brew install xcodegen`), and `pnpm install` in the repository.

```sh
apps/ios/scripts/generate.sh                    # Verdandi.xcodeproj, then open it in Xcode
apps/ios/scripts/run-simulator.sh "iPhone 18 Pro Max"   # build, install, launch, signed in as gh is
apps/ios/scripts/snap.sh /tmp/shot.png "iPhone 18 Pro Max" 3
apps/ios/scripts/test-kit.sh                    # VerdandiKit's tests, on this Mac
VERDANDI_LIVE=1 GH_TOKEN="$(gh auth token)" apps/ios/scripts/test-kit.sh --filter Live
pnpm vitest run --project ios-host              # the host's tests
```

The project is generated: a new Swift file joins it only when `generate.sh` runs again (`run-simulator.sh` does). `run-simulator.sh` hands the app gh's token through a file in the app's own folder, which the app deletes once read (`scripts/dev-token.sh`): never through the launch's environment, which the Simulator writes to its logs. It passes any `VERDANDI_*` variable set for it: `VERDANDI_SELECT=repo:owner/name`, `VERDANDI_ISSUE=owner/name#12`, `VERDANDI_SHEET=settings`, `VERDANDI_APPEARANCE=dark`, `VERDANDI_HOME=<folder>`, `VERDANDI_GO_TO=owner/name#12`, `VERDANDI_NOTICE=<text>`, `VERDANDI_MAP_END=blocking` (see `Verdandi/App/LaunchOptions.swift`).

To run it on an iPhone or iPad, open the project, choose the device and Run. It is signed for the team in `project.yml`.

## Signing in

iOS has no `gh`, so the app signs in itself: with a personal access token, kept in the Keychain. A classic token needs the `repo` and `read:org` scopes; a fine-grained one needs read access to Issues and Metadata of the repositories to track. With a GitHub OAuth App's client ID in `VerdandiGitHubClientID` (`project.yml`), it also offers **Sign in with GitHub**, GitHub's device flow (`VerdandiKit/…/GitHub/DeviceFlow.swift`): the OAuth App needs **Enable Device Flow** ticked, and no secret, as the app keeps none.

To see signing in on a Simulator, launch with `VERDANDI_SIGNED_OUT=1`, which ignores `GH_TOKEN` and forgets the Keychain's token. `VERDANDI_SIGN_IN=<token>` signs in with a token at launch, as if typed: a made-up one shows GitHub's rejection. `VERDANDI_CLIENT_ID=<id>` tries another OAuth App, and `VERDANDI_DEVICE_FLOW=demo` shows the device flow's code without one.

## Design

Liquid Glass is the layer of controls and navigation that floats over the content, never the content itself:

- Navigation, toolbars, sheets, menus, search and popovers take glass from the system: use them as they are (`NavigationSplitView`, `.toolbar`, `.sheet`, `.searchable`, `Menu`), with `ToolbarSpacer` to group toolbar items.
- A custom floating control takes `.glassEffect(.regular.interactive(), in: .capsule)`, several together in a `GlassEffectContainer`; buttons take `.buttonStyle(.glass)`, the main action `.glassProminent`. A bar of controls along the content's edge goes in `.safeAreaBar(edge:)`, so the content scrolls under it with the scroll edge effect.
- Content (rows, cards, bodies) stays solid: `palette.card` or the system's grouped backgrounds, with concentric corners.
- Colours come from the theme the user chose (`config.toml`, as on the desktop) through `@Environment(\.palette)`: open, closed, blocked by (red), blocks (amber), warning. The tint is `palette.accent`.
- Text is the system font, with Dynamic Type; numbers `.monospacedDigit()`. SF Symbols, hierarchical.
- On an iPad: hover effects, context menus, keyboard shortcuts. On an iPhone: swipe actions, `.sensoryFeedback`.
- Words follow the desktop app and the glossary (`GLOSSARY.md`): sidebar entry, tracked repository, view, label filter, match, context issue, blocking map.

## Code

Swift 6, everything on the main actor unless it says otherwise (`SWIFT_DEFAULT_ACTOR_ISOLATION`). VerdandiKit is plain `Sendable` values and the runtime's queue. Comments say why, in the repository's plain style.
