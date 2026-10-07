# Try a native macOS app beside the Electron app

Superseded by [ADR 0008](0008-go-on-with-the-electron-app-only.md): the macOS app is dropped.

Verdandi is built twice for now: the Electron app in `electron/` ([ADR 0001](0001-typescript-electron-stack.md)), and a native macOS app in SwiftUI in `macos/`, with Liquid Glass and without Node, which reads GitHub through `gh` as the Electron app does. It began as an experiment in how far a native app gets, and it looked and felt better on macOS than expected. Which of the two Verdandi goes on with is not decided; until it is, both are kept, each complete in its own folder, so that the choice can be made by comparing them rather than in advance.

The two apps are independent. Each has its own core: the TypeScript core in `electron/packages/core`, and a Swift port of it in `macos/Sources/VerdandiCore`. A change to one app is not made in the other unless asked for, and an issue says which app it is for with an `electron` or `macos` label. They share only the format of `settings.json`, which both read and write, and what lies at the top of the repository: the glossary, these decisions and the research.

The choice hangs on two things:

- **Whether Windows and Linux stay required**, as [Decide supported platform baselines and release delivery](https://github.com/chris-metz/verdandi/issues/11) says. The macOS app cannot serve them. Native apps there (WinUI 3 on Windows, GTK on Linux) would each need a UI of their own, and one core shared between them would mean rewriting it in a language all of them can embed, such as Rust.
- **The cores.** The TypeScript core is covered by far more tests than the Swift port, and handles cases the port does not, such as waiting out a rate limit, a `settings.json` written by a newer version, or a switch of `gh` to another account.

## Considered Options

- **A native UI on the TypeScript core, run as a Node process beside it:** one core for both apps, but the macOS app would ship Node, which it was meant to do without.
- **The macOS app as `apps/macos` in the pnpm workspace:** the Electron app's tooling would own the top of the repository, though either app may be the one kept.

## Consequences

- **The cores drift apart.** Nothing keeps them in step, so the app not chosen is dropped, or ported from the one that is.
- **The macOS app does not do everything the Electron app does.** What it lacks is tracked as issues labelled `macos`.
- **The app icon lives with the Electron app** (`electron/apps/desktop/build/icon.icon`), and the macOS app is built with it from there; dropping the Electron app means moving it first.
- **When the choice is made**, a new ADR records it and supersedes this one, and ADR 0001 too if the macOS app is kept.
