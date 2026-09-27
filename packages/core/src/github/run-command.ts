import { spawn } from "node:child_process";
import type { CommandRunner } from "./command-runner.ts";

/** Runs a command found on PATH, without a shell. */
export const runCommand: CommandRunner = (command, args, options) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      resolve(
        error.code === "ENOENT"
          ? { kind: "not-found" }
          : { kind: "failed-to-start", message: error.message },
      );
    });
    child.on("close", (exitCode) => {
      resolve({ kind: "exited", exitCode, stdout, stderr });
    });
    // gh may exit before reading its input; that surfaces through `close`.
    child.stdin.on("error", () => undefined);
    child.stdin.end(options?.input);
  });
