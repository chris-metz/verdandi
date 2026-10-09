/**
 * `node:child_process` for the iOS host, which runs no processes: the core
 * reaches `gh` only through the command runner the host gives it, which
 * answers over HTTPS instead.
 */

export function spawn(): never {
  throw new Error("iOS runs no processes.");
}

export default { spawn };
