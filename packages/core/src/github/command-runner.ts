/**
 * Runs an external command without a shell. Injected into the `gh` adapter so
 * tests can answer with recorded `gh` transcripts instead of running `gh`.
 */
export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: { input?: string },
) => Promise<CommandResult>;

export type CommandResult =
  | { kind: "exited"; exitCode: number | null; stdout: string; stderr: string }
  | { kind: "not-found" }
  | { kind: "failed-to-start"; message: string };
