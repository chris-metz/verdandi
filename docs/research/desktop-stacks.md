# Cross-platform desktop stacks

Research date: **2026-09-26**. For [Research cross-platform desktop stacks: Go, Rust, TypeScript/Bun](https://github.com/chris-metz/verdandi/issues/6), under [Map: Verdandi MVP spec](https://github.com/chris-metz/verdandi/issues/1). This supplies evidence for the stack decision; it does not select the stack, presentation, architecture, or release policy.

Verdandi requires macOS, Linux, and Windows; an installed, authenticated `gh`; read-only issue navigation; keyboard-first interaction with mouse support; and a UI-independent core reusable by a later TUI. Domain terms follow [GLOSSARY.md](../../GLOSSARY.md). The existing [GitHub issue data access research](github-issue-data-access.md) supplies the API and authentication details.

## Findings

Go/Wails, Rust/Tauri, and TypeScript/Electron all fit the broad application shape. Electrobun offers another viable direction if its published architecture coverage and runtime choices fit the eventual support policy. All can use a web frontend and the same tree/graph libraries. Neither `gh` nor those libraries force the backend language.

The following fit assessments are **inferences from the documented capabilities below**, not comparative benchmarks:

| Candidate         | Core and renderer                                                                 | Conditional fit                                                                           | Main trade-off to accept                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Wails v2**      | Go; system webviews                                                               | Go core and future Bubble Tea TUI; embedded application assets                            | Browser differences and Linux dependencies; updater/release work beyond the surveyed stable tooling                      |
| **Tauri v2**      | Rust; system webviews                                                             | Rust core and future ratatui TUI; integrated bundling and signed updater                  | Rust/frontend boundary and build tooling; browser differences and Linux dependencies                                     |
| **Electron**      | TypeScript/JavaScript on embedded Node; bundled Chromium                          | Node ecosystem, common rendering engine, established desktop APIs and packaging           | Ship and maintain the Node/Chromium runtime; choose a Linux update strategy                                              |
| **Electrobun v2** | TypeScript on default Cottontail or optional Bun; system webviews or optional CEF | TypeScript with selectable runtime/renderer and willingness to validate newer integration | Published macOS targets exclude Intel; Windows signing needs a separate procedure; runtime compatibility must be checked |

There is no like-for-like Verdandi measurement of package size, memory, startup, input latency, or development-loop speed. A small executable and a complete installer containing its browser/runtime are different measurements.

## Release maturity and platform support

### Go / Wails

Wails **v2 is the stable line; v3 is beta**, with the project describing the v3 desktop API as stable. Keep their features separate. The v2 documentation currently has a v2.15.0 header and a v2.16.0 changelog entry; source tags exist while GitHub's latest published stable Release is v2.14.0. An upstream issue records a tag/release publication failure. Pin and verify the chosen module tag instead of treating a documentation header or GitHub's latest-release badge as the entire version story. [Wails FAQ](https://v3.wails.io/faq/), [v2 changelog](https://v2.wails.io/changelog/), [publication issue](https://github.com/wailsapp/wails/issues/5997), [v2.16.0 source](https://github.com/wailsapp/wails/tree/v2.16.0).

The v2 platform matrix documents Windows 10/11 and AMD64/ARM64, Intel and Apple Silicon Macs, and AMD64/ARM64 Linux. Windows needs WebView2; macOS uses WebKit; Linux uses GTK3/WebKitGTK. Newer Linux distributions with WebKitGTK 4.1 use the `webkit2_41` build tag. Compiler/development packages listed in installation instructions should not be confused with end-user runtime requirements. [Wails installation](https://wails.io/docs/gettingstarted/installation/).

Wails v3 changes the Linux baseline to GTK4/WebKitGTK 6.0 by default, with a GTK3/WebKitGTK 4.1 build documented until v3.1. WebKitGTK 4.0-only distributions are unsupported there. Selecting v3 therefore also means accepting a different release line and Linux baseline. [Wails v3 platform FAQ](https://v3.wails.io/faq/).

### Rust / Tauri

The baseline is **Tauri v2**; core runtime `tauri-v2.11.6` was published on September 19, 2026. The monorepo also publishes helper packages and v3 alpha artifacts: its global latest-release endpoint is not a stable-core version selector. [Core release](https://github.com/tauri-apps/tauri/releases/tag/tauri-v2.11.6), [per-package releases](https://v2.tauri.app/release/).

Tauri uses WebView2 on Windows, WKWebView on macOS, and WebKitGTK on Linux. Development prerequisites include Rust and platform compiler tooling; Linux has distro-specific GTK/WebKitGTK 4.1 packages. Webview features follow OS/runtime versions: macOS WebKit follows OS updates, Linux follows its packaged libraries, and Windows follows WebView2. **Inference:** frontend testing only in Chrome cannot certify a system-webview application. [Prerequisites](https://v2.tauri.app/start/prerequisites/), [webview versions](https://v2.tauri.app/reference/webview-versions/).

The official Linux graphics guide documents blank/flickering windows, Wayland/NVIDIA interactions, and potentially slow WebGL/canvas paths. These are risks to validate on the chosen Linux targets, not proof that Linux is unusable. Because Wails shares the system-webview approach, changing the backend language does not by itself remove renderer risks. [Tauri Linux graphics](https://v2.tauri.app/develop/debug/linux-graphics/), [Wails Linux integration](https://wails.io/docs/guides/linux/).

### TypeScript / Electron

Electron embeds **Node.js and Chromium** and supports all three desktop operating systems. The main process runs Node; renderer pages communicate with privileged functionality through preload/IPC. Bun can be a package manager, bundler, or script runner during development, but that does not replace Electron's embedded Node runtime. A packaged app does not require users to install Node or Bun. [Introduction](https://www.electronjs.org/docs/latest), [process model](https://www.electronjs.org/docs/latest/tutorial/process-model).

Current platform documentation lists x64 and ARM64 targets, including Intel/Apple Silicon Macs and Windows ARM; pin the actual target matrix from the selected release artifacts. Bundling one Chromium version reduces cross-engine CSS/DOM variation, while OS text input, GPU, accessibility, and window behavior still need testing. [Supported platforms](https://www.electronjs.org/docs/latest/tutorial/installation). The dated release check found [Electron v44.4.5](https://github.com/electron/electron/releases/tag/v44.4.5), published September 23.

### TypeScript / Electrobun

Electrobun's latest stable release observed was **v2.0.1**, published August 22, 2026. The core runtime and architecture facts here were checked against that tag, not inferred solely from rolling documentation. [Release and assets](https://github.com/blackboardsh/electrobun/releases/tag/v2.0.1).

Hutch orchestrates builds; **Cottontail is the default TypeScript main-process runtime**, with actual Bun selectable through `build.mainProcess: "bun"`. Both use `electrobun/main`. The release also documents native Go/Rust and other main-process options, but those SDKs have different coverage and were not evaluated as separate Verdandi candidates. Cottontail compatibility claims do not establish that every Node/Bun package behaves identically; check the selected dependencies. [Tagged main-process documentation](https://github.com/blackboardsh/electrobun/blob/v2.0.1/docs/src/content/docs/electrobun/guides/native-main-process.mdx), [compatibility guidance](https://framework.blackboard.sh/electrobun/guides/compatability/).

Published targets are **macOS ARM64, Windows x64, and Linux x64/ARM64**. Windows ARM uses x64 emulation; the release workflow does not publish a macOS x64 core artifact. Builds target the host OS/architecture. This is a concrete Intel Mac constraint, not a reason to say all macOS support is absent. [Tagged platform matrix](https://github.com/blackboardsh/electrobun/blob/v2.0.1/docs/src/content/docs/electrobun/guides/cross-platform-development.mdx).

System renderers are WKWebView, WebView2, and WebKitGTK 4.1. Optional bundled **CEF** supplies a pinned Chromium engine at additional size. macOS/Windows can mix native and CEF views; Linux chooses one for the process. Linux still links GTK3, WebKitGTK 4.1, Ayatana AppIndicator, and librsvg in CEF builds. CEF does not make its Linux package dependency-free. [CEF documentation](https://framework.blackboard.sh/electrobun/apis/bundling-cef/), [tagged Linux requirements](https://github.com/blackboardsh/electrobun/blob/v2.0.1/docs/src/content/docs/electrobun/guides/cross-platform-development.mdx).

## Keyboard and drag-and-drop

All four expose native menu/shortcut integration alongside browser input. Wails documents `CmdOrCtrl`; Tauri exposes menu accelerators; Electron documents DOM events, menu accelerators, and `before-input-event`. Electrobun's tagged menu documentation describes single-key Command/Control accelerators, so broader combinations and Linux parity need explicit verification. None supplies Verdandi's complete focus, selection, tree expansion, and return-to-list behavior automatically. [Wails menus](https://wails.io/docs/reference/menus/), [Tauri menus](https://v2.tauri.app/learn/window-menu/), [Electron keyboard shortcuts](https://www.electronjs.org/docs/latest/tutorial/keyboard-shortcuts), [Electrobun menu API](https://github.com/blackboardsh/electrobun/blob/v2.0.1/docs/src/content/docs/electrobun/apis/application-menu.mdx).

Distinguish **internal sidebar reordering**, dragging the application window, and **OS file drops**:

- Tauri's native `dragDropEnabled` defaults to true. Its docs require disabling it for HTML5 frontend drag/drop on Windows. A pointer-based reorder library is a different case and needs testing with the selected configuration. [Tauri window configuration](https://v2.tauri.app/reference/config/#windowconfig).
- Wails v2 offers `EnableFileDrop` and `DisableWebViewDrop`. File paths/coordinates and preventing navigation to dropped files do not constitute a reorder widget. Wails v3 separately documents internal HTML5 drags passing through its native file-drop handling; do not attribute that guarantee to v2. [Wails options](https://wails.io/docs/reference/options/), [v3 file drops](https://v3.wails.io/features/drag-and-drop/files/).
- Electron documents inbound web file drops and outbound `webContents.startDrag`; internal reordering can remain a web interaction. Equivalent native file drag-out across Electrobun's renderers was not established by this research, and it is not an MVP requirement. [Electron native drag/drop](https://www.electronjs.org/docs/latest/tutorial/native-file-drag-drop).

**Validation still needed:** actual target webviews; non-US keyboard layouts and IME; shortcuts while editing search/text; focus restoration after opening an issue/browser; mouse reordering and auto-scroll; a keyboard alternative to reordering; high DPI and trackpads. Native file-drop support should not decide a requirement that only needs internal reordering.

## Distribution, size, signing, and updates

| Candidate         | Packaging and runtime implications                                                                                                                             | Signing and update story                                                                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wails v2**      | Embeds assets in an executable; macOS application packaging and Windows NSIS are documented. System browser/libraries and installed `gh` remain prerequisites. | Windows signing and macOS signing/notarization guides exist. The surveyed v2 docs did not establish a comparable integrated updater; choose/validate external tooling or manual/package-manager updates.               |
| **Tauri v2**      | `.app`/DMG, MSI/NSIS, Debian/RPM/AppImage and other channels; system runtime handling varies by format.                                                        | Integrated signing/bundling docs and updater plugin. Updater signatures are mandatory and separate from OS signing; documented update artifacts cover AppImage, macOS app archive, MSI/NSIS, not every package format. |
| **Electron**      | Ships Node/Chromium and application resources; Forge makes platform distributables. A single installer file is not a single installed executable.              | Forge documents macOS signing/notarization and Windows signing. Built-in `autoUpdater` covers macOS/Windows, not Linux; macOS updates require signing and Windows support depends on packaging.                        |
| **Electrobun v2** | Runnable bundle packaged through self-extracting distribution; docs describe DMG, Windows Setup ZIP, and Linux setup archive. Optional CEF increases payload.  | Documents cross-platform archive/patch updates with a post-exit helper and rollback. macOS signing/notarization is integrated; Windows signing is absent from Hutch's packaging pipeline at the stable tag.            |

Sources: [Wails assets](https://wails.io/docs/introduction/), [NSIS](https://wails.io/docs/guides/windows-installer/), [signing](https://wails.io/docs/guides/signing/); [Tauri distribution](https://v2.tauri.app/distribute/), [updater](https://v2.tauri.app/plugin/updater/); [Forge makers](https://www.electronforge.io/config/makers), [macOS signing](https://www.electronforge.io/guides/code-signing/code-signing-macos), [Windows signing](https://www.electronforge.io/guides/code-signing/code-signing-windows), [Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater); [Electrobun distribution](https://framework.blackboard.sh/electrobun/guides/architecture/overview/), [updates](https://framework.blackboard.sh/electrobun/guides/updates/), [tagged signing guide](https://github.com/blackboardsh/electrobun/blob/v2.0.1/docs/src/content/docs/electrobun/guides/code-signing.mdx).

Wails v3 has a documented updater with GitHub Releases, SHA-256 verification, optional Ed25519 signatures, replacement, and relaunch. That is a capability of the beta option, not evidence of equivalent v2 tooling. [Wails v3 updater](https://v3.wails.io/tutorials/04-self-update-a-wails-app/).

**Size:** system-webview wrappers avoid bundling Chromium by default, but dependencies are still installed, downloaded, or included somewhere. Tauri's documentation illustrates the distinction with a **2–6 MB basic app versus a 70+ MB AppImage**. Its Windows guide estimates **1.8 MB** for a WebView2 bootstrapper, **127 MB** for an offline installer, or **180 MB** for a fixed runtime. These are documentation examples, not current Verdandi measurements or directly comparable results across frameworks. A bundled bootstrapper is not the entire browser. [AppImage size/dependencies](https://v2.tauri.app/distribute/appimage/), [Windows runtime strategies](https://v2.tauri.app/distribute/windows-installer/), [Wails WebView2 handling](https://wails.io/docs/guides/windows/).

Linux bundles still have compatibility baselines: Tauri advises building AppImages on the oldest supported base with WebKitGTK 4.1, giving Ubuntu 22.04/Debian 12 as examples, because glibc compatibility remains relevant. Framework package support is not evidence that host `gh` and its credential store are reachable inside every sandboxed channel. Validate that before choosing Flatpak or an app-store sandbox. [Tauri AppImage guidance](https://v2.tauri.app/distribute/appimage/).

If footprint drives the choice, compare the same synthetic application, same architecture, release build, assets, and equivalent prerequisites. Report compressed download, installed app, additional prerequisite downloads, and cold/warm memory separately. This research cannot rank actual Verdandi sizes.

## A core reusable by a later TUI

The following are feasible separation patterns, **not the decided architecture**:

| Core language | GUI adapter                                                     | Later TUI reuse                                            |
| ------------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| Go            | Wails-bound methods delegate to ordinary Go packages            | Bubble Tea imports the same packages                       |
| Rust          | Tauri commands delegate to a library crate                      | ratatui application depends on that crate                  |
| TypeScript    | Electron IPC or Electrobun RPC delegates to an ordinary package | Ink/OpenTUI imports it with an appropriate runtime adapter |

[Wails bindings](https://wails.io/docs/introduction/), [Tauri commands](https://v2.tauri.app/develop/calling-rust/), [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model), [Bubble Tea](https://github.com/charmbracelet/bubbletea), [ratatui concepts](https://ratatui.rs/concepts/), [Ink](https://github.com/vadimdemedes/ink).

Issue identities, tracked repositories, traversal of sub-issues and blocking chains, query orchestration, and domain errors can live in the reusable core. Window handles, framework state types, DOM/React components, terminal events, and visual focus belong in adapters. Storage/process/HTTP interfaces can isolate runtime-specific behavior. GUI and TUI share application behavior, not HTML components or canvas graphs; this does not inherently require a daemon or network service.

For TypeScript, distinguish language reuse from runtime compatibility. Ink's observed published 7.1.1 package requires Node >=22. OpenTUI's observed core 0.5.12 supports Bun >=1.3 and Node >=26.4 with ESM and `--experimental-ffi`; some features remain Bun-only. Its documented Node acceptance coverage is Linux x64, and its React adapter lacks a dedicated Node CI lane. Do not describe current OpenTUI as Bun-only or assume equally validated runtime/platform combinations. A Cottontail GUI plus Node/Bun TUI adds a compatibility target. [Ink package metadata](https://registry.npmjs.org/ink/latest), [OpenTUI runtime matrix](https://opentui.com/docs/getting-started/runtime-support/), [OpenTUI package metadata](https://registry.npmjs.org/@opentui/core/latest).

## GitHub access and installed gh

`gh api` supports REST/GraphQL and structured request bodies on stdin. Every candidate can delegate requests to it; the language comparison does not reopen the installed/authenticated-`gh` prerequisite. [gh api](https://cli.github.com/manual/gh_api).

| Language/runtime | Process integration                                                                   | Optional native HTTP client                                                                    |
| ---------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Go               | `os/exec`, `CommandContext`; `go-gh` also wraps CLI execution                         | `go-gh/v2` has gh-aware REST/GraphQL clients                                                   |
| Rust             | `std::process::Command` or an async process adapter; call behind narrow core commands | Octocrab offers REST helpers, generic methods, and GraphQL                                     |
| Electron / Node  | Asynchronous `child_process.spawn` / `execFile`                                       | Octokit provides REST/GraphQL, pagination, and related plugins                                 |
| Actual Bun       | `Bun.spawn`                                                                           | Check the chosen client under Bun; do not infer Cottontail compatibility from Node/Bun support |

[Go subprocesses](https://pkg.go.dev/os/exec), [go-gh](https://github.com/cli/go-gh), [Rust Command](https://doc.rust-lang.org/std/process/struct.Command.html), [Octocrab](https://docs.rs/octocrab/latest/octocrab/struct.Octocrab.html), [Node subprocesses](https://nodejs.org/api/child_process.html), [Bun subprocesses](https://bun.sh/reference/bun/spawn), [Octokit](https://github.com/octokit/octokit.js).

SDKs are unnecessary for transport if requests all pass through `gh api`. If the eventual design gets a token from `gh` and makes native HTTP requests, the core handles that credential and must check the SDK's coverage of recent relationship fields. The previous GitHub research documents these alternatives; no new OAuth/login system is implied by choosing Rust or TypeScript.

**Packaged discovery is common work:** a GUI launched from Finder/desktop may not inherit PATH from shell startup files. Tauri documents this explicitly; it is an OS launch issue, not a Rust-specific limitation. Verify the intended executable and authentication environment from packaged apps, including Start-menu launch on Windows. [Tauri packaged PATH caveat](https://v2.tauri.app/distribute/macos-application-bundle/), [gh environment](https://cli.github.com/manual/gh_help_environment).

**Derived implementation requirements:** argument arrays instead of shell interpolation; JSON through stdin; asynchronous calls with bounded concurrency and cancellation; distinct process/API errors; separate stdout/stderr; a defined executable-discovery/recovery policy. Keep shell/process APIs behind domain operations rather than exposing arbitrary execution to rendered issue content. These are adapter concerns across all languages, not a selected transport implementation. [Go exec](https://pkg.go.dev/os/exec), [Node execFile/spawn](https://nodejs.org/api/child_process.html), [Tauri trust boundaries](https://v2.tauri.app/security/), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security).

## Tree and graph libraries

These are browser/frontend choices available with all four wrappers, subject to their webview features. This is an inference from the libraries' supported environments, not a tested four-wrapper integration. A Go or Rust core can supply serializable issue/relationship records while the frontend handles layout and interaction.

| Library          | What it supplies                                                                         | Verdandi assessment                                                                                                                                                                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ELK / elkjs**  | Layout, including layered directed graphs, ports, and optional Web Workers; no rendering | Useful candidate for branching/converging blocking chains and edge routing. Still needs a renderer, keyboard behavior, and correctly packaged worker assets. [elkjs](https://github.com/kieler/elkjs)                                                                                                              |
| **Dagre**        | Renderer-independent directed layout from node sizes                                     | Simpler layout candidate for modest diagrams; no accessible UI. React Flow documents a limitation for sub-flows linked to outside nodes. [Dagre](https://github.com/dagrejs/dagre/wiki), [layout comparison](https://reactflow.dev/learn/layouting/layouting)                                                      |
| **Cytoscape.js** | Graph data/algorithms, canvas rendering, layouts, interaction, compound nodes            | Useful for graph exploration. Keyboard/screen-reader equivalence was not established here; verify an integration or provide semantic navigation alongside the canvas. [Documentation](https://js.cytoscape.org/)                                                                                                   |
| **React Flow**   | React node/edge UI, custom nodes, pan/zoom; external layout                              | Useful for rich issue cards. Offers focusable nodes/edges, keyboard selection, ARIA labels/live messages; configure editing-like defaults for read-only navigation. [Accessibility](https://reactflow.dev/learn/advanced-use/accessibility), [layout integration](https://reactflow.dev/learn/layouting/layouting) |

React Flow recommends memoization, narrow state subscriptions, collapsed trees, and simpler styles for large diagrams. Cytoscape documents the effects of graph size, edges, styles, and pixel ratio. Neither establishes a universal safe node count. Layout time and rendering/input latency should be measured separately using representative synthetic trees and chains. [React Flow performance](https://reactflow.dev/learn/advanced-use/performance), [Cytoscape performance](https://js.cytoscape.org/#performance).

**Assessment:** an indented semantic DOM tree may cover sub-issues without a graph library; blocking chains may benefit from a different presentation. Existing prototype tickets should decide that. No library supplies Verdandi's cross-repository identity, incomplete-access states, or navigation semantics automatically.

## Development loop

| Candidate  | Documented loop                                                                                               | Qualification                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wails      | `wails dev` runs the app, generates bindings, supports frontend development, and rebuilds/restarts Go changes | Browser frontend development helps UI iteration; packaged behavior still needs separate validation. [Development guide](https://wails.io/docs/gettingstarted/development/)                                                     |
| Tauri      | `tauri dev` uses a frontend dev server and watches/rebuilds Rust                                              | Initial dependency compilation can take minutes; later builds use the cache. [Development guide](https://v2.tauri.app/develop/)                                                                                                |
| Electron   | Frontend HMR with suitable tooling; main/preload have separate restart/reload boundaries                      | Forge's Vite plugin is still marked experimental. This qualifies that plugin, not Electron's platform maturity. [Vite plugin](https://www.electronforge.io/config/plugins/vite)                                                |
| Electrobun | Whole-app watch rebuild/relaunch, or template-provided Vite frontend HMR                                      | Current docs say frontend HMR does not continuously rebuild main code, and Windows watch asks the developer to close the app for rebuilding. [Hot reloading](https://framework.blackboard.sh/electrobun/guides/hot-reloading/) |

No timing experiment was performed. Familiarity with Go, Rust, TypeScript, and the selected frontend is a decision input; generic claims that one language makes Verdandi faster to develop would exceed the evidence.

## What this resolves and leaves open

The research establishes feasible candidates, version-specific limitations, shared web visualization options, and same-language core/TUI reuse paths. Conditional choices are now concrete: Wails for a Go core, Tauri for a Rust core with integrated distribution tooling, Electron for Node plus consistent Chromium, or Electrobun if its runtime/renderer and support matrix are acceptable. None is selected here.

[Decide the language and GUI stack](https://github.com/chris-metz/verdandi/issues/7) can now use this evidence and the API research. If Wails or Electrobun is chosen, the release line or main runtime/renderer is part of that choice. [Decide onboarding and recovery for GitHub access](https://github.com/chris-metz/verdandi/issues/10) already owns missing-`gh`, identity, and access-recovery behavior.

The packaging fog is now precise enough for a separate decision about OS/CPU baselines, Linux distributions/display servers, artifact formats, runtime prerequisites, signing/notarization, and manual/package-manager/in-app updates, after the stack choice. All three operating systems remain required. Detailed CI design and the final core/UI boundary still require decisions; this research supplies their constraints.

**Evidence limits:** official documentation, source, release assets, and package metadata were inspected. No packaged Verdandi app, signed installer, update transaction, keyboard/drag trial, performance benchmark, or three-OS smoke test was run. Recheck rolling documentation against pinned versions when implementing. Use synthetic issue data for later prototypes; this note contains no credentials or issue-data snapshots.
