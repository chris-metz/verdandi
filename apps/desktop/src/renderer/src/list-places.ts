import { scopeLabel, type SidebarScope as Scope } from "./scope";

/** Where the user is in a list: its selection and scroll position. */
export interface ListPlace {
  selectedId: string | undefined;
  scrollTop: number;
}

/**
 * Each tab's place in each sidebar entry's list it showed, kept while the
 * window is open and never persisted, so that two tabs on one entry each
 * keep their own. Expansion is the entry's, kept by the core.
 */
const places = new Map<number, Map<string, ListPlace>>();

export function rememberedPlace(tab: number, scope: Scope): ListPlace {
  return (
    places.get(tab)?.get(scopeLabel(scope)) ?? {
      selectedId: undefined,
      scrollTop: 0,
    }
  );
}

export function rememberPlace(tab: number, scope: Scope, place: ListPlace) {
  const tabPlaces = places.get(tab) ?? new Map<string, ListPlace>();
  places.set(tab, tabPlaces);
  tabPlaces.set(scopeLabel(scope), place);
}

/**
 * A tab opened from another starts where that one is in the entry's list,
 * then goes its own way.
 */
export function copyPlace(from: number, to: number, scope: Scope): void {
  const place = places.get(from)?.get(scopeLabel(scope));
  if (place) rememberPlace(to, scope, place);
}

/** A renamed repository's entry keeps its places under its new name. */
export function movePlace(from: Scope, to: Scope): void {
  for (const tabPlaces of places.values()) {
    const place = tabPlaces.get(scopeLabel(from));
    if (!place) continue;
    tabPlaces.delete(scopeLabel(from));
    tabPlaces.set(scopeLabel(to), place);
  }
}

/** Removing an entry discards its cursors and scroll positions. */
export function forgetPlace(scope: Scope): void {
  for (const tabPlaces of places.values()) tabPlaces.delete(scopeLabel(scope));
}
