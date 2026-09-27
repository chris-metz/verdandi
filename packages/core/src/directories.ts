import path from "node:path";

export interface HostEnvironment {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  homedir: string;
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
