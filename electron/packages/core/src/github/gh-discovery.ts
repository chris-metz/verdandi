import path from "node:path";
import type { GhExecutable, UnusableGh } from "../contract.ts";
import type { HostEnvironment } from "../directories.ts";
import type { CommandRunner } from "./command-runner.ts";

/** The oldest gh Verdandi can use: the first with `gh auth status --json`. */
const minimumVersion = [2, 81, 0] as const;

/** How long gh may take to say its version, in milliseconds. */
const probeTimeout = 10 * 1000;

/** Whether a file is a gh Verdandi can use, or why not. */
export type GhProbe =
  | { usable: true; gh: GhExecutable }
  /** `missing` when there is no file there at all. */
  | { usable: false; reason: string; missing: boolean };

/**
 * Runs `<path> --version`, without a shell, and says whether it is a gh
 * Verdandi can use. Nothing else is run to find out.
 */
export async function probeGh(
  runCommand: CommandRunner,
  file: string,
  platform: NodeJS.Platform,
): Promise<GhProbe> {
  // Node no longer starts these without a shell, which Verdandi never uses.
  if (platform === "win32" && /\.(?:cmd|bat)$/i.test(file)) {
    return {
      usable: false,
      reason: "Verdandi cannot run .cmd or .bat files. Choose gh.exe.",
      missing: false,
    };
  }
  const result = await runCommand(file, ["--version"], {
    timeout: probeTimeout,
  });
  switch (result.kind) {
    case "not-found":
      return {
        usable: false,
        reason: "There is no file there.",
        missing: true,
      };
    case "failed-to-start":
      return {
        usable: false,
        reason: `It cannot be run: ${result.message}`,
        missing: false,
      };
    case "timed-out":
      return {
        usable: false,
        reason: `It did not answer \`--version\` within ${String(probeTimeout / 1000)} seconds.`,
        missing: false,
      };
    case "exited":
      break;
  }
  const version = /^gh version (\S+)/.exec(result.stdout)?.[1];
  if (result.exitCode !== 0 || version === undefined) {
    return {
      usable: false,
      reason: "It is not GitHub CLI: it did not report a gh version.",
      missing: false,
    };
  }
  if (isOlderThanMinimum(version)) {
    return {
      usable: false,
      reason: `It is GitHub CLI ${version}; Verdandi needs ${minimumVersion.join(".")} or later.`,
      missing: false,
    };
  }
  return { usable: true, gh: { path: file, version } };
}

/** What looking for gh found. */
export interface GhSearch {
  /** The first usable gh, if any. */
  gh: GhExecutable | undefined;
  /**
   * The ones found before it, or all found if none is usable, that cannot be
   * used: those that exist, and the chosen one in any case.
   */
  notUsable: UnusableGh[];
}

/**
 * Looks for a usable gh: where the user chose it, then on PATH in its order,
 * then in well-known install locations, which a desktop launch leaves off
 * PATH. Relative PATH entries are passed over, so that gh never runs from
 * the working directory.
 */
export async function findGh({
  runCommand,
  host,
  chosen,
}: {
  runCommand: CommandRunner;
  host: HostEnvironment;
  chosen: string | undefined;
}): Promise<GhSearch> {
  const candidates = [
    ...(chosen === undefined ? [] : [chosen]),
    ...onPath(host),
    ...wellKnownLocations(host),
  ];
  const tried = new Set<string>();
  const notUsable: UnusableGh[] = [];
  for (const candidate of candidates) {
    const key = host.platform === "win32" ? candidate.toLowerCase() : candidate;
    if (tried.has(key)) continue;
    tried.add(key);
    const probe = await probeGh(runCommand, candidate, host.platform);
    if (probe.usable) return { gh: probe.gh, notUsable };
    if (!probe.missing || candidate === chosen) {
      notUsable.push({ path: candidate, reason: probe.reason });
    }
  }
  return { gh: undefined, notUsable };
}

/** Where gh would be in each absolute PATH entry. */
function onPath({ platform, env }: HostEnvironment): string[] {
  const paths = platform === "win32" ? path.win32 : path.posix;
  // Windows names it `Path`, and its environment ignores case.
  const name =
    platform === "win32"
      ? Object.keys(env).find((key) => key.toUpperCase() === "PATH")
      : "PATH";
  const value = name === undefined ? undefined : env[name];
  return (value ?? "")
    .split(paths.delimiter)
    .filter((directory) => paths.isAbsolute(directory))
    .map((directory) => paths.join(directory, ghFileName(platform)));
}

/**
 * Where gh's installers and common package managers put it, by operating
 * system.
 */
function wellKnownLocations({
  platform,
  env,
  homedir,
}: HostEnvironment): string[] {
  if (platform === "win32") {
    const join = (...segments: string[]) => path.win32.join(...segments);
    const localAppData = env.LOCALAPPDATA || join(homedir, "AppData", "Local");
    return [
      join(env.ProgramFiles || "C:\\Program Files", "GitHub CLI", "gh.exe"),
      join(
        env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
        "GitHub CLI",
        "gh.exe",
      ),
      join(localAppData, "Programs", "GitHub CLI", "gh.exe"),
      join(localAppData, "Microsoft", "WinGet", "Links", "gh.exe"),
      join(homedir, "scoop", "shims", "gh.exe"),
      join(
        env.ChocolateyInstall || "C:\\ProgramData\\chocolatey",
        "bin",
        "gh.exe",
      ),
    ];
  }
  const home = (relative: string) => path.posix.join(homedir, relative);
  const nix = [
    home(".nix-profile/bin/gh"),
    "/run/current-system/sw/bin/gh",
    "/nix/var/nix/profiles/default/bin/gh",
  ];
  const user = [home(".local/share/mise/shims/gh"), home(".local/bin/gh")];
  if (platform === "darwin") {
    return [
      "/opt/homebrew/bin/gh",
      "/usr/local/bin/gh",
      "/opt/local/bin/gh",
      ...nix,
      ...user,
    ];
  }
  return [
    "/usr/bin/gh",
    "/usr/local/bin/gh",
    "/home/linuxbrew/.linuxbrew/bin/gh",
    home(".linuxbrew/bin/gh"),
    "/snap/bin/gh",
    ...nix,
    ...user,
  ];
}

function ghFileName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "gh.exe" : "gh";
}

/**
 * Whether a version such as `2.40.0` is older than the minimum. One that is
 * not numbered so, such as a development build's, is taken as recent.
 */
function isOlderThanMinimum(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  for (const [index, minimum] of minimumVersion.entries()) {
    const part = Number(match[index + 1]);
    if (part !== minimum) return part < minimum;
  }
  return false;
}
