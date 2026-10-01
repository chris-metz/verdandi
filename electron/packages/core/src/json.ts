/** Whether a parsed JSON value is an object: not null, and not a list. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
