## The app

The repository is a pnpm workspace: the Electron app in `apps/desktop`, its TypeScript core in `packages/core`.

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

After changing the renderer, drive the app with the `run-desktop` skill (`.agents/skills/run-desktop/SKILL.md`) before committing, and look at its screenshots.
