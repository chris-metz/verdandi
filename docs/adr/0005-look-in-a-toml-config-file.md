# Keep how Verdandi looks in a TOML config file the settings dialog writes

How Verdandi looks, meaning the appearance, the light and dark theme and later the fonts and text size, is kept in `config.toml` in the config directory:

- `$XDG_CONFIG_HOME/verdandi` when that variable is set, otherwise `~/.config/verdandi` on macOS and Linux
- `%APPDATA%\Verdandi` on Windows
- under `VERDANDI_HOME` when that is set

It is not kept in `settings.json` or in machine-local desktop state. The file is the only place these choices are kept.

- **The settings dialog writes it.** It changes one value at a time and keeps the user's comments, key order and formatting as they are.
- **Changes by hand apply at once**, while the app runs.
- **A value that cannot be used falls back to its default**, and the user is told which one and why.
- **When the file cannot be read as TOML, all defaults apply**, and the dialog does not write to it until it can be read again.

We chose this because these are exactly the choices people keep in dotfiles and want on every machine, and ADR 0002 keeps the config directory for configuration that is safe to share. We chose TOML over the JSON of `settings.json` because this file is meant to be edited and commented by hand, the way terminal and editor configs are.

## Considered Options

- **In `settings.json`**: it already exists, is watched and roams. But it is private user data that ADR 0002 keeps out of dotfiles, and its strict JSON allows no comments.
- **In machine-local desktop state**: this is the simplest option, but the choices would neither be visible nor travel to other machines.
- **JSON with comments**: this needs no new library. TOML reads better by hand and is what users of Ghostty, Alacritty and Starship already keep in their dotfiles.
- **The file overrides the dialog**: the dialog would store its choices elsewhere and grey out whatever the file sets. That means two places to look and a dialog that sometimes cannot change anything.

## Consequences

- **Writing back:** a TOML library that can only parse and stringify would drop comments. The file is written with `@decimalturn/toml-patch`, which parses the file and patches the original text. It is pure JavaScript, MIT licensed and supports TOML 1.1.
- **Machine-local settings:** zoom, window bounds and anything else tied to one machine stay in desktop state, not in `config.toml`.
- **Moving the file:** it will be hard, because users keep it in their own repositories.
