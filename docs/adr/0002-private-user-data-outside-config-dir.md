# Keep tracked repositories and views out of the config directory

Tracked repositories and views are stored as private user data in the OS's application-data directory (`~/Library/Application Support/Verdandi` on macOS, `%APPDATA%\Verdandi` on Windows, `$XDG_DATA_HOME/verdandi` on Linux), not in `~/.config/verdandi`, where tools like gh keep their config. Many people publish their dotfiles, and `~/.config` is what those repositories sweep up. A list of tracked repositories and saved searches such as `repo:acme/payments-internal` or `org:client-x is:blocked` can reveal private repository names, client names, unannounced projects and organization memberships that GitHub lets members hide. Verdandi cannot tell which users that applies to, so the safe location is the default. The data stays portable: anyone who wants it on several machines syncs it deliberately.

Machine-local desktop state (the gh executable location, window bounds, the last selected sidebar entry) lives in a separate, non-roaming location (`%LOCALAPPDATA%\Verdandi\desktop` on Windows, `$XDG_STATE_HOME/verdandi/desktop` on Linux, `~/Library/Application Support/Verdandi/desktop` on macOS). Electron's `userData` is redirected there before startup, because Electron would otherwise write Chromium's caches and storage to `~/.config/Verdandi` on Linux and to the roaming profile on Windows.

## Considered Options

- **`~/.config/verdandi`, like gh:** the familiar place for CLI users and the easiest to put under version control, but it leaves excluding possibly confidential data to each user who publishes dotfiles.
- **Views in `~/.config`, tracked repositories local:** view search texts reveal the same repository and organization names, so this split does not remove the exposure.
- **One location for everything:** simpler, but on Windows machine-specific state and Chromium caches would roam with the user profile.

## Consequences

`~/.config/verdandi` stays reserved for configuration that is safe to share, such as a later user-written keybindings file. A `VERDANDI_HOME` environment variable relocates both locations under one directory for tests and portable use.

Decided in [Decide where user settings are stored and in what format](https://github.com/chris-metz/verdandi/issues/12).
