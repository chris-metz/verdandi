/**
 * `node:util` for the iOS host: `isDeepStrictEqual`, for the plain values
 * the core compares, such as its setup and rate-limit states.
 */

export function isDeepStrictEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null ||
    Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)
  )
    return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return (
      a.length === other.length &&
      a.every((value, index) => isDeepStrictEqual(value, other[index]))
    );
  }
  if (a instanceof Date) return a.getTime() === (b as Date).getTime();
  if (a instanceof Map) {
    const other = b as Map<unknown, unknown>;
    return (
      a.size === other.size &&
      [...a].every(
        ([key, value]) =>
          other.has(key) && isDeepStrictEqual(value, other.get(key)),
      )
    );
  }
  if (a instanceof Set) {
    const other = b as Set<unknown>;
    return a.size === other.size && [...a].every((value) => other.has(value));
  }
  const keys = Object.keys(a);
  const record = a as Record<string, unknown>;
  const otherRecord = b as Record<string, unknown>;
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) =>
        Object.hasOwn(otherRecord, key) &&
        isDeepStrictEqual(record[key], otherRecord[key]),
    )
  );
}

export default { isDeepStrictEqual };
