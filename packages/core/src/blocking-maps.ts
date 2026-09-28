import type {
  BlockingMap,
  BlockingSide,
  IssueSummary,
  Problem,
} from "./contract.ts";
import type { IssueStore } from "./issue-store.ts";
import { atOrAfter, type Clock, type Moment } from "./moments.ts";
import { problemOf } from "./problems.ts";
import type { SendRequest, Urgency } from "./request-queue.ts";

const sides = ["blockedBy", "blocking"] as const;
interface Relationships {
  ids: string[];
  readAt: Moment;
  problem: Problem | undefined;
  complete: boolean;
}

/** Session-wide relationship lists; issue fields live in the shared issue store. */
export function createBlockingMaps(
  store: IssueStore,
  request: SendRequest,
  clock: Clock,
) {
  const lists = new Map<string, Relationships>();
  const key = (id: string, side: BlockingSide) => `${id}:${side}`;
  const list = (id: string, side: BlockingSide) => lists.get(key(id, side));

  async function readList(
    id: string,
    side: BlockingSide,
    since: Moment,
    urgency: () => Urgency | undefined,
    push: () => void,
  ) {
    const known = list(id, side);
    if (
      known &&
      known.complete &&
      !known.problem &&
      atOrAfter(known.readAt, since)
    )
      return;
    const readAt = clock();
    let after: string | undefined;
    const ids = new Set<string>();
    let problem: Problem | undefined;
    do {
      const answer = await request(
        "fetchRelationships",
        [id, side, after],
        urgency,
      );
      if (!answer.ok) {
        problem = problemOf(answer.error);
        lists.set(key(id, side), {
          ids: problem.kind === "unavailable" ? [] : (known?.ids ?? [...ids]),
          readAt: known?.readAt ?? readAt,
          problem,
          complete: false,
        });
        push();
        return;
      }
      store.put(answer.value.issues, readAt);
      for (const issue of answer.value.issues) ids.add(issue.id);
      if (answer.value.incomplete) problem = problemOf(answer.value.incomplete);
      after = answer.value.nextPage;
      // Revalidation retains the previous complete list until its replacement arrives.
      if (!known || after === undefined)
        lists.set(key(id, side), {
          ids: [...ids],
          readAt,
          problem,
          complete: after === undefined,
        });
      push();
    } while (after !== undefined);
  }

  function build(
    root: string,
    summarize: (id: string) => IssueSummary | undefined,
  ): BlockingMap {
    const map: BlockingMap = {
      cards: [],
      edges: [],
      ends: { blockedBy: { kind: "none" }, blocking: { kind: "none" } },
      problems: [],
    };
    const rootIssue = summarize(root);
    if (!rootIssue) return map;
    const cards = new Map<string, BlockingMap["cards"][number]>();
    cards.set(root, { issue: rootIssue, step: 0, badges: {} });
    for (const side of sides) {
      const incomplete = new Set<string>();
      const visiting = new Set<string>();
      const visited = new Set<string>();
      const order: string[] = [];
      const routes: { from: string; to: string; cycle: boolean }[] = [];
      const badges = new Map<string, BlockingMap["cards"][number]["badges"]>();
      function visit(id: string) {
        if (visited.has(id)) return;
        visited.add(id);
        visiting.add(id);
        const issue = summarize(id);
        if (!issue) {
          incomplete.add(id);
          visiting.delete(id);
          return;
        }
        const badge: BlockingMap["cards"][number]["badges"] = {};
        badges.set(id, badge);
        if (id !== root && issue.state === "closed")
          badge[side] = { kind: "closed" };
        else {
          const relationships = list(id, side);
          const missing = Math.max(
            0,
            issue[side].total - (relationships?.ids.length ?? 0),
          );
          if (missing > 0) {
            badge[side] = { kind: "unloaded", count: missing };
            incomplete.add(id);
          }
          if (relationships?.problem) {
            map.problems.push(relationships.problem);
            incomplete.add(id);
          }
          if (
            (!relationships && id === root) ||
            relationships?.complete === false
          )
            incomplete.add(id);
          for (const other of relationships?.ids ?? []) {
            if (!summarize(other)) {
              incomplete.add(id);
              continue;
            }
            const cycle = visiting.has(other);
            routes.push({ from: id, to: other, cycle });
            if (!cycle) visit(other);
          }
        }
        visiting.delete(id);
        order.push(id);
      }
      visit(root);
      // Removing only the cycle-closing edges leaves a DAG. Its topological
      // order lets every route contribute without enumerating every path.
      const depths = new Map([[root, 0]]);
      for (const id of order.reverse()) {
        for (const route of routes.filter(
          (route) => route.from === id && !route.cycle,
        )) {
          depths.set(
            route.to,
            Math.max(depths.get(route.to) ?? 0, (depths.get(id) ?? 0) + 1),
          );
        }
      }
      let folded = 0;
      for (const id of visited) {
        const issue = summarize(id);
        const depth = depths.get(id);
        if (!issue || depth === undefined) continue;
        if (depth > 2) {
          folded++;
          continue;
        }
        const card = cards.get(id) ?? {
          issue,
          step: side === "blockedBy" ? -depth : depth,
          badges: {},
        };
        Object.assign(card.badges, badges.get(id));
        cards.set(id, card);
      }
      const endpoint = (id: string) =>
        (depths.get(id) ?? 0) > 2 ? `edge:${side}` : id;
      for (const route of routes) {
        const from = endpoint(side === "blockedBy" ? route.to : route.from);
        const to = endpoint(side === "blockedBy" ? route.from : route.to);
        if (from === to && !route.cycle) continue;
        const edge = {
          from,
          to,
          cycle: route.cycle,
          closed:
            summarize(route.from)?.state === "closed" ||
            summarize(route.to)?.state === "closed",
        };
        const existing = map.edges.find(
          (other) => other.from === from && other.to === to,
        );
        if (existing) existing.cycle ||= edge.cycle;
        else map.edges.push(edge);
      }
      map.ends[side] =
        incomplete.size > 0
          ? { kind: "unknown" }
          : folded > 0
            ? { kind: "folded", count: folded }
            : { kind: "none" };
    }
    map.cards = [...cards.values()];
    return map;
  }

  function reachable(root: string, side: BlockingSide): Set<string> {
    const ids = new Set<string>();
    function visit(id: string) {
      if (ids.has(id)) return;
      ids.add(id);
      if (id !== root && store.get(id)?.state !== "open") return;
      for (const other of list(id, side)?.ids ?? []) visit(other);
    }
    visit(root);
    return ids;
  }

  return {
    build,
    issueIds(root: string): string[] {
      return [...new Set(sides.flatMap((side) => [...reachable(root, side)]))];
    },
    async load(
      root: string,
      since: Moment,
      urgency: () => Urgency | undefined,
      push: () => void,
    ) {
      await Promise.all(
        sides.map(async (side) => {
          // Refresh every list already reached on this side. New traversal is
          // bounded to the root and its open neighbours, even when cached
          // relationships place a neighbour farther out by its longest route.
          const loaded = [...reachable(root, side)].filter(
            (id) =>
              list(id, side) &&
              (id === root || store.get(id)?.state === "open"),
          );
          await readList(root, side, since, urgency, push);
          const neighbours = (list(root, side)?.ids ?? []).filter(
            (id) => id !== root && store.get(id)?.state === "open",
          );
          await Promise.all(
            [...new Set([...neighbours, ...loaded])]
              .filter((id) => id !== root && store.get(id)?.state === "open")
              .map((id) => readList(id, side, since, urgency, push)),
          );
        }),
      );
    },
  };
}
