---
name: release
description: Release Verdandi. Agrees the release notes with the user from what changed since the last release, then publishes with release.sh.
---

# Release Verdandi

`release.sh` publishes a release: the Mac DMG and the Windows installer on GitHub Releases, and the cask in the Homebrew tap ([ADR 0009](../../../docs/adr/0009-releases-on-github-and-homebrew.md)). You write its release notes with the user first. Publishing is public and can't be taken back, so `release.sh` runs only after the user's go in step 3.

## 1. Gather what changed

```bash
git fetch --tags origin main
LAST=$(git describe --tags --abbrev=0 --match 'v[0-9]*' origin/main)
git log --reverse --no-merges --format='%h %s%n%n%b' "$LAST..origin/main"
gh issue list --state closed --search "closed:>=$(git log -1 --format=%cs "$LAST") reason:completed" --json number,title
```

Without a tag, this is the first release: `release.sh` writes its notes itself. Show them to the user (`first_release_notes` in `release.sh`), propose `0.1.0`, and go on with step 3.

Done when you have read every commit since the tag, its body too wherever the subject leaves open what changed for a user.

## 2. Draft the notes

Turn the commits into points a user reads, one per change they notice. Merge the commits that make one change: a feature, its follow-up fixes and its README update are one point. Name a closed issue's number where a point delivers it, as `(#82)`. Leave out what users never see: refactors, tests, glossary, ADRs, research, CI and release tooling.

Write each point as the commit subjects are written, saying what the user can do now or what changed for them, e.g. "Drag the sidebar's edge to make it wider or narrower (#82)".

Propose the version from the last tag: the minor up (`0.1.0` → `0.2.0`) when any point adds or changes behaviour, the patch up (`0.1.0` → `0.1.1`) when every point fixes something.

Done when every commit since the tag is in a point or on the left-out list.

## 3. Agree with the user

Show the numbered points, then the left-out commits with one line each, then the proposed version. Ask which points to drop, merge or reword, which left-out commit belongs in, and whether the version fits. Apply the answers and show the whole notes again, until the user approves them word for word and gives the go to publish.

Done when the user has approved the exact notes and version, and said to publish.

## 4. Publish

Write the approved notes, exactly as approved, as a Markdown list to `dist/release-notes.md`, and run from the repository's root:

```bash
./release.sh --notes-file dist/release-notes.md X.Y.Z
```

For the first release, leave out `--notes-file`. The run takes 10 to 20 minutes, waiting for Apple's notarization and the Windows build on GitHub Actions. It checks everything before it builds, and stops with `Can't release: …` when something is missing: pass that on to the user. It publishes only after the DMG and the installer are built and verified. If it stops half way through publishing, show the user its last lines, which say what to finish by hand.

Done when `release.sh` has printed `Released Verdandi X.Y.Z` and you have given the user the release's link.
