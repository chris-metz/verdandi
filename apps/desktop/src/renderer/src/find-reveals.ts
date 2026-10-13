import type { IssueNode, IssueTree } from "@verdandi/core/contract";
import { allNodes } from "./list-navigation";

/** Only the ancestors needed to show this occurrence; no exploration or fetch. */
export function pathToTextMatch(
  trees: readonly IssueNode[],
  id: string,
): string[] {
  function visit(
    nodes: readonly IssueNode[],
    path: string[],
  ): string[] | undefined {
    for (const node of nodes) {
      if (node.issue.id === id) return path;
      const found = visit(node.subIssues, [...path, node.issue.id]);
      if (found) return found;
    }
    return undefined;
  }
  return visit(trees, []) ?? [];
}

/** An overlay over Core's expansion. Its trees and match marks remain untouched. */
export function withFindReveals(
  trees: readonly IssueTree[],
  opened: readonly string[],
): IssueTree[] {
  const ids = new Set(opened);
  function visit<T extends IssueNode>(node: T): T {
    return {
      ...node,
      expanded: node.expanded || ids.has(node.issue.id),
      subIssues: node.subIssues.map(visit),
    };
  }
  return trees.map(visit);
}

/** Session-local paths, shared manual actions invalidating them in every tab (ADR 0011). */
export function createFindReveals() {
  const places = new Map<string, Map<number, readonly string[]>>();
  const listeners = new Set<() => void>();
  const empty: readonly string[] = [];
  function notify() {
    for (const listener of listeners) listener();
  }
  function get(tab: number, list: string): readonly string[] {
    return places.get(list)?.get(tab) ?? empty;
  }
  return {
    get,
    moveScope(from: string, to: string) {
      if (from === to) return;
      for (const [key, tabs] of [...places]) {
        if (!key.startsWith(`${from}:`)) continue;
        places.delete(key);
        places.set(`${to}${key.slice(from.length)}`, tabs);
      }
      notify();
    },
    forgetScope(scope: string) {
      for (const key of places.keys()) {
        if (key.startsWith(`${scope}:`)) places.delete(key);
      }
      notify();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open(tab: number, list: string, path: readonly string[]) {
      const previous = get(tab, list);
      if (path.every((id) => previous.includes(id))) return;
      const tabs = places.get(list) ?? new Map<number, readonly string[]>();
      tabs.set(tab, [...new Set([...previous, ...path])]);
      places.set(list, tabs);
      notify();
    },
    manual(list: string, trees: readonly IssueTree[], id?: string) {
      const branch =
        id === undefined
          ? undefined
          : allNodes(trees).find((node) => node.issue.id === id);
      const affected = new Set(
        branch ? allNodes([branch]).map((node) => node.issue.id) : [id],
      );
      const tabs = places.get(list);
      if (!tabs) return;
      for (const [tab, opened] of tabs) {
        const kept =
          id === undefined ? empty : opened.filter((id) => !affected.has(id));
        if (kept.length !== opened.length) tabs.set(tab, kept);
      }
      notify();
    },
  };
}

export const findReveals = createFindReveals();
