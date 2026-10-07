# Release on GitHub and Homebrew, the Mac app built locally and the Windows app on GitHub Actions

Verdandi is released on GitHub Releases as a DMG for Macs with Apple Silicon, signed with a Developer ID and notarized, and as an unsigned installer for Windows on x64. Mac users can install it with the cask `verdandi` in the tap `chris-metz/homebrew-tap` (`brew install --cask chris-metz/tap/verdandi`). This follows Pacemark's [ADR 0003](https://github.com/chris-metz/pacemark/blob/main/docs/adr/0003-signed-releases-via-own-homebrew-tap.md): the same Developer ID, of a paid team that isn't the maintainer's own and whose Account Holder agreed that Verdandi, too, shows their name and Team ID, and the same tap. `release.sh` builds the Mac app on the maintainer's Mac, so the Developer ID key, which signs Pacemark as well, never leaves its keychain. It has GitHub Actions build the Windows installer, which needs no secrets as nothing is signed, and publishes only once both are built and verified.

## Considered Options

- **The Mac app on GitHub Actions too:** one place for the whole release and no need for the maintainer's Mac, but the Developer ID key and the notarization key would sit in GitHub secrets, where a leak would hit Pacemark and the Account Holder's name as well.
- **A signed Windows app:** there is no certificate. Azure Artifact Signing takes individual developers only from the USA and Canada, and SignPath Foundation's free signing needs an OSI license, which Verdandi doesn't have yet. [#83](https://github.com/chris-metz/verdandi/issues/83) keeps that open.
- **A Scoop bucket for Windows,** as the tap is for Homebrew: Scoop downloads without the mark that makes SmartScreen ask, but it is another repo to keep up. Left for later.
- **Intel Macs too,** as a universal DMG or a second one: Electron 44 runs from macOS 13, so Intel Macs could run Verdandi, but every release would build and notarize twice, or ship a DMG twice the size. Adding a second DMG later only changes the cask.
- **Release notes from merge titles,** as Pacemark makes them: Verdandi commits straight to `main`, without merges.

## Consequences

- **Windows warns before the app starts.** SmartScreen asks for every new version until it has gathered reputation, and Smart App Control, where it is on, blocks the app outright. The README says what to do.
- **Versions** are `X.Y.Z` with tags `vX.Y.Z`. The first is `0.1.0`, because users still add repositories by hand in `settings.json`.
- **Release notes** are agreed with the maintainer by the `release` skill, from the commits since the last tag. `release.sh` publishes only the notes it is given, or, run by hand, the commits it opens in an editor.
- **No updates inside the app.** Homebrew users get them with `brew upgrade`, everyone else downloads the next release. A new Electron, for Chromium's security fixes, ships as a release like any other change.
- **No Linux release:** Linux users run Verdandi from source.
- **Local builds stay as they are:** `install-app.sh` builds an unsigned app. The maintainer's own Mac doesn't install Verdandi with Homebrew, because both write `/Applications/Verdandi.app`.
