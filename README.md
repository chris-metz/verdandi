<p align="center"><img src="electron/apps/desktop/build/icon.png" width="128" height="128" alt=""></p>

<h1 align="center">Verdandi</h1>

A keyboard-first desktop client for GitHub issues across many repositories, focused on how issues relate: sub-issue hierarchies and blocking relationships that cross repository boundaries. Vocabulary is in [`GLOSSARY.md`](GLOSSARY.md), decisions in [`docs/adr/`](docs/adr/).

<p align="center">
  <img src="docs/screenshots/issue-light.png" width="49%" alt="An issue page in Verdandi, light: the issues that block it and those it blocks, as a map">
  <img src="docs/screenshots/issue-dark.png" width="49%" alt="The same issue page, dark">
</p>

Verdandi is a personal project, shared in the open. There are no releases, support or roadmap to rely on.

It runs on macOS, Windows and Linux, in TypeScript and Electron: see [`electron/README.md`](electron/README.md). It reads GitHub only through the [GitHub CLI](https://cli.github.com/) (`gh`) 2.81.0 or later, signed in to github.com (`gh auth login`).

## Install into Applications

```sh
./install-app.sh
```

It builds the app and installs it as `/Applications/Verdandi.app`. It quits a running Verdandi first, and starts the new one.
