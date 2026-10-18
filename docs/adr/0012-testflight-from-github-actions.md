# Upload the iOS app to TestFlight from GitHub Actions, unlike the Mac release

The iOS app ([ADR 0010](0010-an-ios-app-on-the-same-core.md)) reaches TestFlight from a GitHub Actions workflow that the maintainer starts by hand, on `main`. It is signed for the team whose Developer ID signs the Mac release ([ADR 0009](0009-releases-on-github-and-homebrew.md)), an individual membership of someone else, so the maintainer can't sign with it in Xcode at all: only its Account Holder sees its certificates. The workflow therefore signs through the App Store Connect API, with a team API key kept for Verdandi alone: Codemagic's CLI tools (`codemagic-cli-tools`, which need no Codemagic account) fetch the Apple Distribution certificate and the App Store profile, and create them when there are none, and the IPA goes up for the team's internal testers. The key and the certificate's private key are GitHub secrets. ADR 0009 keeps the Developer ID and the notarization key out of GitHub secrets; this key is a separate one, which the Account Holder can revoke without touching Pacemark or the Mac release, and the Developer ID stays in the maintainer's keychain.

## Considered Options

- **On the maintainer's Mac, as `release.sh`:** the keys stay in the keychain, but nothing there could sign for the team without the API either, and every upload would need that Mac.
- **Codemagic,** where another of the team's apps is built: it holds one of the team's keys already, so no new party would, but it is a third service beside GitHub Actions, which already builds the iOS app on every push, and one the maintainer means to leave.
- **Cloud signing by Xcode** (`xcodebuild -allowProvisioningUpdates`): no certificate key to keep, but it needs an Admin key, which can also manage the team's users, and it isn't confirmed to work for individual memberships.
- **A certificate and profile the Account Holder makes by hand:** the key would only upload, but the certificate expires every year, and uploads stop until the Account Holder makes the next one.
- **Uploading with every desktop release,** from `release.sh`: one version everywhere, but a failure at Apple would hold up the desktop release, and an iOS fix would need a whole release.

## Consequences

- **A leaked key reaches all the team's apps,** not only Verdandi. It has the role the API needs to make certificates and profiles, and no higher.
- **GitHub secrets can't be read back.** The maintainer's password manager keeps the key, its Key ID and Issuer ID, and the certificate's private key; the iOS README says which secret each one is and how to set it again.
- **Only internal testers,** who are App Store Connect users of the team, get the builds, without Beta App Review. There are no external testers yet.
- **The iOS app has its own version,** set by hand in `apps/ios/project.yml`; the workflow numbers each build one above the last in TestFlight.
- **A build expires after 90 days.** Builds go up when the maintainer starts the workflow, not with desktop releases.
