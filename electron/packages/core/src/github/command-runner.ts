/**
 * Runs an external command without a shell. Injected into the `gh` adapter so
 * tests can answer with recorded `gh` transcripts instead of running `gh`.
 */
export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: {
    input?: string;
    /** Milliseconds after which the command is stopped, if it still runs. */
    timeout?: number;
  },
) => Promise<CommandResult>;

export type CommandResult =
  | { kind: "exited"; exitCode: number | null; stdout: string; stderr: string }
  /** There is no such command. */
  | { kind: "not-found" }
  /** The command exists but could not be started, e.g. it is not executable. */
  | { kind: "failed-to-start"; message: string }
  /** The command ran longer than its timeout, and was stopped. */
  | { kind: "timed-out" };
