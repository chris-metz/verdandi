# GitHub access prototype

Throwaway visual evidence for [Decide onboarding and recovery for GitHub access](https://github.com/chris-metz/verdandi/issues/10). This is a standalone prototype, not application implementation. All data and file paths are synthetic; no GitHub requests or commands run and nothing is persisted.

Open `index.html` in a browser, or run from the repository root:

```sh
python3 -m http.server 4178 --bind 127.0.0.1 --directory docs/prototypes/github-access
```

Visit <http://127.0.0.1:4178/>. Layout C is the selected design and the default: a setup dialog that blocks the entire application until GitHub CLI is usable and authenticated. The user chose it because it makes this prerequisite explicit. The controls below the application are prototype-only.

## Explore

- Switch layouts using the arrows or the left/right arrow keys: A is one page, B uses guided steps, C is the blocking dialog.
- **Scenario** forces `gh not found`, `Invalid executable`, `Sign-in needed`, or `Connected`, even when the real computer's gh setup works.
- **Platform** changes the example installation guidance and executable locations for macOS, Linux, or Windows. It does not validate actual operating-system behavior.
- **Choose gh executable** opens a simulated file picker. Pick `notes.txt` to see validation fail, or a gh path to reach the sign-in instruction. No real files are selected or read.
- **Check again** in the sign-in scenario simulates completed terminal authentication, then opens a simplified repository picker. Its search and owner filters are illustrative only.
- **State** shows the current simulation state; **Reset** starts again. Nothing persists across a reload except the layout, scenario, and platform encoded in the URL.

Share a state with URL parameters, for example `?variant=C&scenario=missing&os=mac` or `?variant=C&scenario=login&os=windows`.

The prototype answers how the setup screen should look and lets the user inspect rare error states. It does not implement executable discovery, authentication, token handling, access diagnosis, account-change detection, or the full repository picker. The resolution on the linked decision ticket is authoritative for product behavior.
