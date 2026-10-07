# Build Verdandi on TypeScript and Electron

Verdandi is built in TypeScript on Electron, with its bundled Chromium, rather than on a system-webview wrapper (Go/Wails, Rust/Tauri) or Electrobun. One language then covers the UI-independent core, the React UI, and a later TUI, which can run the same core on Node (e.g. with Ink). All three operating systems render with one browser engine, so what is tested on one is what the others get; WebKitGTK on Linux was the weakest link of the system webviews. The team's existing work is TypeScript and React.

## Considered Options

- **Go + Wails v2:** Bubble Tea and `go-gh` are strong fits, but it means two languages and three rendering engines, and v2 has no integrated updater (v3 was beta).
- **Rust + Tauri v2:** the best integrated bundling and signed updater, but Rust was new to the team, first builds are slow, and it shares Wails's system-webview differences.
- **TypeScript + Electrobun:** no published Intel macOS build, no Windows signing in its packaging pipeline, and the youngest runtime of the four.

## Consequences

We accept a larger download and higher memory use than a system-webview app, and we must ship Electron updates to keep up with Chromium security fixes. Electron's built-in updater does not cover Linux, so release delivery needs its own Linux answer.

Evidence: [Cross-platform desktop stacks research](../research/desktop-stacks.md). Decided in [Decide the language and GUI stack](https://github.com/chris-metz/verdandi/issues/7).
