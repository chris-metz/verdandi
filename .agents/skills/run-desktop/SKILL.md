---
name: run-desktop
description: Launch and drive the Verdandi desktop app to see a change working, clicking through it, reading its text and taking screenshots in light and dark. Use after changing the renderer (layout, CSS, focus, scrolling, keys), or when asked to run or screenshot the app.
---

# Run the desktop app

`driver.mjs` builds the app, launches the real Electron window through Playwright on macOS, and runs commands, one per line from stdin. Send a whole flow in one call; the app quits when the input ends.

```bash
node .agents/skills/run-desktop/driver.mjs <<'EOF'
launch
entry cli/cli
issue 13840
loaded
theme dark
ss issue-dark
EOF
```

Then open every screenshot you took and look at it. A blank window or the setup blocker is a failed run, whatever the exit code says.

It needs `pnpm install` and a `gh` signed in to github.com: the app reads GitHub as that account. Each `launch` gets a fresh scratch `VERDANDI_HOME` that tracks only the repositories it names, deleted on quit, so the user's own settings stay untouched.

## Commands

| Command                               | Does                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `launch [owner/name …]`               | Builds and launches the app tracking these repositories (default `cli/cli`), and waits for the sidebar |
| `launch --fresh`                      | Launches without a settings file, as on first launch, and waits for the repository picker              |
| `entry <owner/name \| All>`           | Selects a sidebar entry                                                                                |
| `issue <number \| owner/name#number>` | Opens an issue from the list shown, and waits until its page has read the issue                        |
| `click <css>` / `click-text <text>`   | Clicks the first match, as the mouse would                                                             |
| `menu <label>`                        | Chooses an application menu item by its label, e.g. `Settings…`; key presses never reach the menu      |
| `press <key>`                         | Presses a key, e.g. `Escape`, `r`, `j`                                                                 |
| `type <text>`                         | Types text where the keyboard is, e.g. into the repository picker's input                              |
| `loaded`                              | Waits until the screen shown has loaded or failed, and prints its header's status                      |
| `wait <css>` / `wait-text <text>`     | Waits up to a minute for the first match                                                               |
| `scroll <css>`                        | Scrolls the first match to the top                                                                     |
| `text [css]`                          | Prints the text shown by the first match, or the whole window                                          |
| `eval <js>`                           | Evaluates an expression in the window, prints it as JSON                                               |
| `theme <light \| dark>`               | Switches the operating system's appearance, and waits until the page sees it                           |
| `size <width> <height>`               | Resizes the page, 1200 × 800 at launch                                                                 |
| `ss [name]`                           | Screenshot to `$SCREENSHOT_DIR` (default `$TMPDIR/verdandi-shots`)                                     |
| `opened`                              | The links the app opened in the browser                                                                |
| `settings`                            | Prints the scratch home's `settings.json`, or says there is none                                       |
| `config [<toml> \| --remove]`         | Writes `config.toml`, `\n` between lines, or deletes it; with nothing, prints it. See below            |
| `quit`                                | Closes the app and deletes its scratch home                                                            |

A failed command prints `ERROR <command>: …`, the rest still runs, and the exit code is 1. Lines starting with `//` are comments. Run it from a terminal without stdin redirected for a `driver>` prompt.

## The look

`config.toml` sets the appearance and the themes. Write it before `launch` for the app to start with it, or after to change it while the app runs: then `config` waits until the app has read it, and prints what it uses and any problems.

```bash
node .agents/skills/run-desktop/driver.mjs <<'EOF'
config dark_theme = "github-dark-dimmed"\nappearance = "dark"
launch
ss dimmed
config appearance = "light"
ss light
EOF
```

`theme` switches the appearance as the operating system would, overriding the file's until it changes again.

The settings dialog opens with `menu Settings…`; its tiles and the appearance control are `[role="radio"]` in `[role="radiogroup"]`.

## Gotchas

- **Public test data only.** This repository is public: read only public repositories, and never name a private one or copy its content anywhere. `cli/cli` has about a thousand open issues in varied Markdown; issue 13840 has 148 comments, two pages.
- **Wait for data, not time.** `issue` returns once the page has its issue; sub-issues and comments arrive after it. `loaded` waits for all of it, until the header's refresh button stops spinning. Text such as "Updated" is no signal, since issue titles can contain it too.
- **Keys go where the keyboard is.** `entry`, `issue` and `click` click like a mouse and move focus with it, so `press Escape` after `issue` goes back to the list; an `eval` that calls `.click()` moves no focus.
- **The browser never opens.** `shell.openExternal` only records its links, for `opened` to list.
- **Text matches visible elements only**, so text inside closed `<details>` is skipped.
- **Selectors:**
  - sidebar entries: `[role="option"][title="owner/name"]`
  - list rows: `[role="treeitem"]`
  - issue page sections: `section[aria-label="Description"]`, `section[aria-label="Comments"]`
  - comments: `[data-scroll-anchor^="comment:"]`
  - rendered HTML: `.markdown-body`
  - the page's scroller: `main [data-pane-focus]`
  - the repository picker: `[role="dialog"]`, its rows `[aria-label="Suggested repositories"] [role="option"]`
