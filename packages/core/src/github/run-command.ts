import { spawn } from "node:child_process";
import type { CommandRunner } from "./command-runner.ts";

/**
 * Runs a command without a shell: a path, or a name found on PATH. One that
 * outlives its timeout is killed.
 */
export const runCommand: CommandRunner = (command, args, options) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer =
      options?.timeout === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill();
          }, options.timeout);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve(
        error.code === "ENOENT"
          ? { kind: "not-found" }
          : { kind: "failed-to-start", message: error.message },
      );
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve(
        timedOut
          ? { kind: "timed-out" }
          : { kind: "exited", exitCode, stdout, stderr },
      );
    });
    // gh may exit before reading its input; that surfaces through `close`.
    child.stdin.on("error", () => undefined);
    child.stdin.end(options?.input);
  });
