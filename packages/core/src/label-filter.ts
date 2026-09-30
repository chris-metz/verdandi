import type { Label } from "./contract.ts";

/**
 * Whether two labels are the same to a label filter: named alike, whatever
 * the case, whichever repository each comes from.
 */
function sameLabel(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Whether an issue with these labels carries every label of a filter. */
export function carriesEvery(
  labels: readonly Label[],
  filter: readonly Label[],
): boolean {
  return filter.every((wanted) =>
    labels.some((label) => sameLabel(label.name, wanted.name)),
  );
}

/** A label filter with a label added, unless it has one of that name. */
export function withLabel(filter: readonly Label[], label: Label): Label[] {
  return filter.some((other) => sameLabel(other.name, label.name))
    ? [...filter]
    : [...filter, { name: label.name, color: label.color }];
}

/** A label filter without the label of a name. */
export function withoutLabel(filter: readonly Label[], name: string): Label[] {
  return filter.filter((label) => !sameLabel(label.name, name));
}
