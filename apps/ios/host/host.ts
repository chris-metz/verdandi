/**
 * The core as the iOS app runs it on JavaScriptCore: the same core as the
 * desktop app's, with `gh` answered over HTTPS (`http-gh.ts`) and Node's
 * file system and timers answered by the app (`shims/`, `polyfills.ts`).
 * The app reaches it as the desktop renderer does, through the contract:
 * requests by name with their arguments, and events pushed by name.
 */
import {
  createConfigFile,
  createCore,
  createGhAdapter,
  createLocalStateFile,
  createSettingsFile,
  type HostEnvironment,
  type TokenSource,
} from "@verdandi/core";
import {
  eventNames,
  requestNames,
  type Contract,
  type CoreRequests,
} from "@verdandi/core/contract";
import { builtInThemes, themeCatalogue } from "./themes.ts";
import { createHttpGh, ghFolder, type GitHubHttp } from "./http-gh.ts";
import {
  native,
  type GitHubOutcome,
  type GitHubRequest,
  type HostCallbacks,
} from "./native.ts";
import { describe, fireTimer } from "./polyfills.ts";
import { folderChanged } from "./shims/fs.ts";

/** What the app starts the host with. */
export interface HostOptions {
  /**
   * Where the core keeps `settings.json`, `config.toml` and its
   * machine-local state: the app's own folder.
   */
  home: string;
  /** The font families the app offers, the defaults first. */
  fonts: { interfaceFont: string; codeFont: string; installed: string[] };
}

/** The host, as the app calls it on `globalThis.__host`. */
export interface Host extends HostCallbacks {
  /** Creates the core; requests before it fail. */
  start(optionsJSON: string): void;
  /**
   * Makes a request of the contract, its arguments as a JSON array; the
   * answer comes through `respond` with the same ID.
   */
  request(id: number, name: string, argsJSON: string): void;
  /** Every theme Verdandi ships, with its colours, as JSON. */
  themes(): string;
}

/** GitHub's API through the app, which adds its token. */
function nativeGitHub(): GitHubHttp & {
  answered(id: number, outcomeJSON: string): void;
} {
  let nextRequest = 1;
  const pending = new Map<number, (outcome: GitHubOutcome) => void>();
  return {
    send(request: GitHubRequest) {
      const id = nextRequest++;
      return new Promise<GitHubOutcome>((resolve) => {
        pending.set(id, resolve);
        native().github(id, JSON.stringify(request));
      });
    },
    tokenSource() {
      const source = native().tokenSource();
      return source === "stored" ||
        source === "GH_TOKEN" ||
        source === "GITHUB_TOKEN"
        ? (source satisfies TokenSource)
        : undefined;
    },
    answered(id, outcomeJSON) {
      const resolve = pending.get(id);
      if (!resolve) return;
      pending.delete(id);
      let outcome: GitHubOutcome;
      try {
        outcome = JSON.parse(outcomeJSON) as GitHubOutcome;
      } catch (error) {
        outcome = { kind: "unreachable", message: describe(error) };
      }
      resolve(outcome);
    },
  };
}

/** Creates the host; the app must have set the native functions first. */
export function createHost(): Host {
  const github = nativeGitHub();
  let core: (Contract & { dispose(): void }) | undefined;

  return {
    start(optionsJSON) {
      if (core) throw new Error("The core has started already.");
      const options = JSON.parse(optionsJSON) as HostOptions;
      // The core finds `gh` on this PATH, where only the host answers.
      const host: HostEnvironment = {
        platform: "darwin",
        env: { PATH: ghFolder, VERDANDI_HOME: options.home },
        homedir: options.home,
      };
      const runCommand = createHttpGh(github);
      const started = createCore({
        github: (gh) => createGhAdapter({ runCommand, gh }),
        runCommand,
        host,
        settings: createSettingsFile(host),
        localState: createLocalStateFile(host),
        config: createConfigFile(host, themeCatalogue, {
          interfaceFont: options.fonts.interfaceFont,
          codeFont: options.fonts.codeFont,
        }),
      });
      for (const name of eventNames)
        started.on(name, (payload) => {
          native().emit(name, JSON.stringify(payload));
        });
      core = started;
      void started.setInstalledFonts(options.fonts.installed);
    },
    request(id, name, argsJSON) {
      const respond = (ok: boolean, payload: unknown) => {
        let json: string;
        try {
          json = JSON.stringify(payload ?? null);
        } catch (error) {
          native().respond(
            id,
            false,
            JSON.stringify({ message: describe(error) }),
          );
          return;
        }
        native().respond(id, ok, json);
      };
      const fail = (error: unknown) => {
        respond(false, {
          message: error instanceof Error ? error.message : String(error),
        });
      };
      if (!core) {
        fail(new Error("The core has not started."));
        return;
      }
      if (!requestNames.includes(name as keyof CoreRequests)) {
        fail(new Error(`Unknown request: ${name}`));
        return;
      }
      const started = core;
      void Promise.resolve()
        .then(() => {
          const args = JSON.parse(argsJSON) as unknown[];
          const request = started[name as keyof CoreRequests] as (
            ...args: unknown[]
          ) => Promise<unknown>;
          return request(...args);
        })
        .then(
          (value) => {
            respond(true, value);
          },
          (error: unknown) => {
            native().log("warn", `${name} failed: ${describe(error)}`);
            fail(error);
          },
        );
    },
    themes() {
      return JSON.stringify(builtInThemes);
    },
    fireTimer,
    folderChanged,
    githubAnswered(id, outcomeJSON) {
      github.answered(id, outcomeJSON);
    },
  };
}
