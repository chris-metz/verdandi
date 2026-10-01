## Two apps

`electron/` holds the Electron app and the TypeScript core, a pnpm workspace whose commands run in `electron/`. `macos/` holds a native macOS app, a Swift package with its own Swift core. They are independent: a change to one app stays in that app, unless the user asks for both. They share only the format of `settings.json`.

## Git workflow

For now, commit and push directly to `main`. Before every push to `main`, run the checks of each app the commits touch, and push only when they pass:

- `electron/`: `pnpm check` (typecheck, lint, format check and tests).
- `macos/`: `swift build` and `swift test`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `chris-metz/verdandi`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default label strings: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Running the app

After changing the Electron renderer, drive the app with the `run-desktop` skill (`electron/.agents/skills/run-desktop/SKILL.md`) before committing, and look at its screenshots.

After changing the macOS app's views, build it and take screenshots with `macos/scripts/snap.sh` (see `macos/README.md`), and look at them. Its window stays in the background: brought to the front, it takes the keyboard from whatever the user is typing in.
