## The app

The repository is a pnpm workspace: the Electron app in `apps/desktop`, its TypeScript core in `packages/core`, and the iPhone and iPad app in `apps/ios`, which runs the same core on JavaScriptCore (see `apps/ios/README.md`).

The iOS app reads the core's contract (`packages/core/src/contract.ts`) through Swift types that mirror it by hand, in `apps/ios/VerdandiKit/Sources/VerdandiKit/Contract/`. After a change to the contract, update the Swift types in the same commit; the contract tests (`ContractTests.swift`, which `apps/ios/scripts/test-kit.sh` runs) fail on any payload Swift cannot read.

## Git workflow

For now, commit and push directly to `main`. Before every push to `main`, run `pnpm check` (typecheck, lint, format check and tests), and push only when it passes.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `chris-metz/verdandi`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default label strings: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Running the app

After changing the renderer, drive the app with the `run-desktop` skill (`.agents/skills/run-desktop/SKILL.md`) before committing, and look at its screenshots. After changing the iOS app, run it with `apps/ios/scripts/run-simulator.sh` and look at it with `apps/ios/scripts/snap.sh`; after changing the core, also run `apps/ios/scripts/test-kit.sh`, which runs the core on JavaScriptCore.
