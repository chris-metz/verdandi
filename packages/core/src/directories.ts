import path from "node:path";

export interface HostEnvironment {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  homedir: string;
}

/**
 * Where the core keeps user data (`settings.json`): private, portable and
 * outside `~/.config` (ADR 0002). It roams with a Windows profile, and
 * `VERDANDI_HOME` relocates it for tests and portable use.
 */
export function userDataDirectory({
  platform,
  env,
  homedir,
}: HostEnvironment): string {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const join = (...segments: string[]) => paths.join(...segments);
  if (env.VERDANDI_HOME) return env.VERDANDI_HOME;
  switch (platform) {
    case "darwin":
      return join(homedir, "Library/Application Support/Verdandi");
    case "win32":
      return join(
        env.APPDATA || join(homedir, "AppData", "Roaming"),
        "Verdandi",
      );
    default: {
      // The XDG spec says to ignore relative paths.
      const dataHome =
        env.XDG_DATA_HOME && paths.isAbsolute(env.XDG_DATA_HOME)
          ? env.XDG_DATA_HOME
          : join(homedir, ".local/share");
      return join(dataHome, "verdandi");
    }
  }
}

/**
 * Where the desktop app keeps machine-local state; Electron's `userData` is
 * redirected here. It never roams with a Windows profile, and
 * `VERDANDI_HOME` relocates it for tests and portable use.
 */
export function desktopStateDirectory({
  platform,
  env,
  homedir,
}: HostEnvironment): string {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const join = (...segments: string[]) => paths.join(...segments);
  if (env.VERDANDI_HOME) return join(env.VERDANDI_HOME, "desktop");
  switch (platform) {
    case "darwin":
      return join(homedir, "Library/Application Support/Verdandi/desktop");
    case "win32":
      return join(
        env.LOCALAPPDATA || join(homedir, "AppData", "Local"),
        "Verdandi",
        "desktop",
      );
    default: {
      // The XDG spec says to ignore relative paths.
      const stateHome =
        env.XDG_STATE_HOME && paths.isAbsolute(env.XDG_STATE_HOME)
          ? env.XDG_STATE_HOME
          : join(homedir, ".local/state");
      return join(stateHome, "verdandi/desktop");
    }
  }
}

/**
 * Where the user's configuration is kept (`config.toml`): safe to share and
 * where dotfiles live (ADR 0002, ADR 0005). `~/.config` on macOS too, as
 * terminal and editor configs are, and `VERDANDI_HOME` relocates it for tests
 * and portable use.
 */
export function configDirectory({
  platform,
  env,
  homedir,
}: HostEnvironment): string {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const join = (...segments: string[]) => paths.join(...segments);
  if (env.VERDANDI_HOME) return env.VERDANDI_HOME;
  if (platform === "win32")
    return join(env.APPDATA || join(homedir, "AppData", "Roaming"), "Verdandi");
  // The XDG spec says to ignore relative paths.
  const configHome =
    env.XDG_CONFIG_HOME && paths.isAbsolute(env.XDG_CONFIG_HOME)
      ? env.XDG_CONFIG_HOME
      : join(homedir, ".config");
  return join(configHome, "verdandi");
}
