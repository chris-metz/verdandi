import { scopeLabel, type SidebarScope as Scope } from "./scope";

/** Where the user is in a list: its selection and scroll position. */
export interface ListPlace {
  selectedId: string | undefined;
  scrollTop: number;
}

/**
 * Each sidebar entry's place in its list, kept while the window is open and
 * never persisted. Expansion is kept by the core.
 */
const places = new Map<string, ListPlace>();

export function rememberedPlace(scope: Scope): ListPlace {
  return (
    places.get(scopeLabel(scope)) ?? {
      selectedId: undefined,
      scrollTop: 0,
    }
  );
}

export function rememberPlace(scope: Scope, place: ListPlace): void {
  places.set(scopeLabel(scope), place);
}

/** A renamed repository's entry keeps its place under its new name. */
export function movePlace(from: Scope, to: Scope): void {
  const place = places.get(scopeLabel(from));
  if (!place) return;
  places.delete(scopeLabel(from));
  places.set(scopeLabel(to), place);
}

/** Removing an entry discards its cursor and scroll position. */
export function forgetPlace(scope: Scope): void {
  places.delete(scopeLabel(scope));
}
