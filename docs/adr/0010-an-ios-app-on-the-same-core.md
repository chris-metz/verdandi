# An iPhone and iPad app in SwiftUI, on the same core run on JavaScriptCore

Verdandi gets an app for iPhone and iPad, in `apps/ios`: one SwiftUI app for both, with Liquid Glass, for iOS 26 and later. It runs the desktop app's core, `packages/core`, unchanged, on JavaScriptCore, which iOS has. Its interface reaches the core through the contract (`packages/core/src/contract.ts`), as the desktop renderer does: requests by name, and events pushed by name, as JSON.

iOS runs no processes, so there is no `gh`. The core still runs it: the iOS host gives the core a command runner (`apps/ios/host/http-gh.ts`) that answers `gh --version`, `gh auth status` and `gh api` over HTTPS, as gh would. The core's gh adapter, its request queue, rate limits, account changes and errors work as on the desktop, and none of them knows it runs on a phone. The app sends those requests with a token it keeps in the Keychain; the token never reaches the core. Node's file system, paths, hashing and timers are stand-ins the app answers.

This keeps one core. ADR 0008 dropped the native macOS app because its Swift port of the core drifted from the TypeScript one; an iOS app with a second port would drift the same way.

## Considered Options

- **A Swift port of the core,** starting from the macOS app's (tag `macos-app-final`): no JavaScript engine, but two cores again, which nothing keeps in step.
- **The desktop renderer in a web view** (Capacitor or the like): one interface for all, but it looks and behaves like a web page on a phone, and Liquid Glass is the system's own.
- **The core behind a server:** no engine on the phone, but a service to run and trust with tokens, for a personal project.
- **A real Node on iOS** (nodejs-mobile): the core without stand-ins, but a large, old runtime to ship and keep up.

## Consequences

- **Signing in is the app's own.** It takes a personal access token, or GitHub's device flow once a GitHub OAuth App's client ID is set in `apps/ios/project.yml`. `GH_TOKEN` in the app's environment stands in for both during development, as gh honours it.
- **The core's files live in the app's folder** (`VERDANDI_HOME`), not in the desktop's. Tracked repositories and views are not shared with the desktop app.
- **JavaScriptCore runs without a JIT in apps.** Reading GitHub, not the core, sets how fast a list loads: `cli/cli`'s 1,000 issues load as fast either way.
- **The core reads one screen at a time,** as the desktop shows one per tab. On an iPad, the list stays beside the issue page, so the app shows the list to the core again once the page has loaded.
- **A change to the core reaches the iOS app with its next build,** which bundles it. `pnpm check` runs the host's tests; `apps/ios/scripts/test-kit.sh` runs the core on JavaScriptCore.
- **The desktop app is unchanged.** The iOS app shares its themes, so `config.toml` names the same ones.
