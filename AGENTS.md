## Git workflow

For now, commit and push directly to `main`. Run `pnpm check` (typecheck, lint, format check and tests) before every push to `main`, and push only when it passes.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `chris-metz/verdandi`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default label strings: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Running the app

After changing the renderer, drive the app with the `run-desktop` skill (`.agents/skills/run-desktop/SKILL.md`) before committing, and look at its screenshots.
