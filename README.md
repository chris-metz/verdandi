<p align="center"><img src="electron/apps/desktop/build/icon.png" width="128" height="128" alt=""></p>

<h1 align="center">Verdandi</h1>

A keyboard-first desktop client for GitHub issues across many repositories, focused on how issues relate: sub-issue hierarchies and blocking relationships that cross repository boundaries. Vocabulary is in [`GLOSSARY.md`](GLOSSARY.md), decisions in [`docs/adr/`](docs/adr/).

<p align="center">
  <img src="docs/screenshots/issue-light.png" width="49%" alt="An issue page in Verdandi, light: the issues that block it and those it blocks, as a map">
  <img src="docs/screenshots/issue-dark.png" width="49%" alt="The same issue page, dark">
</p>

## Two apps

Verdandi comes as two apps, each complete in its own folder:

- [`electron/`](electron/): for macOS, Windows and Linux, in TypeScript and Electron. See [`electron/README.md`](electron/README.md).
- [`macos/`](macos/): an experimental native macOS app in SwiftUI, with Liquid Glass and without Node. See [`macos/README.md`](macos/README.md).

Both read GitHub only through the [GitHub CLI](https://cli.github.com/) (`gh`) 2.81.0 or later, signed in to github.com (`gh auth login`). Both read and write the same `settings.json`, so they show the same tracked repositories and views; run one of them at a time.
