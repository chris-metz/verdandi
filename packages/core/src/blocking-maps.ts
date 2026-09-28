import type {
  BlockingEnd,
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
  nextPage?: string | undefined;
}

interface Exploration {
  expanded: boolean;
  paused: boolean;
  run: { active: boolean } | undefined;
}

/** Session-wide relationship lists; issue fields live in the shared issue store. */
export function createBlockingMaps(
  store: IssueStore,
  request: SendRequest,
  clock: Clock,
  paused: () => boolean,
) {
  const lists = new Map<string, Relationships>();
  const reading = new Map<string, Promise<void>>();
  const key = (id: string, side: BlockingSide) => `${id}:${side}`;
  const list = (id: string, side: BlockingSide) => lists.get(key(id, side));
  const explorations = new Map<string, Exploration>();
  function exploration(root: string, side: BlockingSide): Exploration {
    const id = key(root, side);
    let state = explorations.get(id);
    if (!state) {
      state = { expanded: false, paused: false, run: undefined };
      explorations.set(id, state);
    }
    return state;
  }

  async function readList(
    id: string,
    side: BlockingSide,
    since: Moment,
    urgency: () => Urgency | undefined,
    push: () => void,
    remaining: () => number = () => 100,
    extent = Infinity,
  ) {
    // A refresh and an exploration may meet at the same list. Wait for the
    // existing read, then only re-read it if this caller needs newer data.
    const pending = reading.get(key(id, side));
    if (pending) await pending;
    if (urgency() === undefined || remaining() <= 0) return;
    const known = list(id, side);
    if (
      known &&
      known.complete &&
      !known.problem &&
      atOrAfter(known.readAt, since)
    )
      return;
    const work = Promise.resolve().then(readPages);
    reading.set(key(id, side), work);
    push();
    try {
      await work;
    } finally {
      reading.delete(key(id, side));
      push();
    }

    async function readPages() {
      const resuming =
        known &&
        !known.problem &&
        !known.complete &&
        atOrAfter(known.readAt, since);
      const readAt = resuming ? known.readAt : clock();
      let after = resuming ? known.nextPage : undefined;
      const ids = new Set<string>(resuming ? known.ids : []);
      let problem: Problem | undefined;
      do {
        const first = Math.min(100, remaining(), extent - ids.size);
        if (urgency() === undefined || first <= 0) return;
        const answer = await request(
          "fetchRelationships",
          [id, side, after, first],
          urgency,
        );
        if (!answer.ok) {
          problem = problemOf(answer.error);
          lists.set(key(id, side), {
            ids:
              problem.kind === "unavailable"
                ? []
                : [...new Set([...(known?.ids ?? []), ...ids])],
            readAt: known?.readAt ?? readAt,
            problem,
            complete: false,
          });
          push();
          return;
        }
        store.put(answer.value.issues, readAt);
        for (const issue of answer.value.issues) ids.add(issue.id);
        if (answer.value.incomplete)
          problem = problemOf(answer.value.incomplete);
        after = answer.value.nextPage;
        // Revalidation retains the previous complete list until its replacement arrives.
        if (!known || !known.complete || after === undefined)
          lists.set(key(id, side), {
            ids: [...ids],
            readAt,
            problem,
            complete: after === undefined,
            nextPage: after,
          });
        push();
      } while (after !== undefined);
    }
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
      const state = exploration(root, side);
      const window = state.expanded ? Infinity : 2;
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
          const inaccessible =
            relationships?.complete &&
            (!relationships.problem ||
              relationships.problem.kind === "unavailable") &&
            missing > 0;
          if (missing > 0) {
            badge[side] = {
              kind: inaccessible ? "inaccessible" : "unloaded",
              count: missing,
            };
            incomplete.add(id);
          }
          if (relationships?.problem) {
            map.problems.push(relationships.problem);
            incomplete.add(id);
            if (relationships.problem.kind !== "interrupted" && !inaccessible)
              badge[side] = { kind: "failed", problem: relationships.problem };
          }
          if (reading.has(key(id, side))) {
            badge[side] = { kind: paused() ? "paused" : "loading" };
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
        if (depth > window) {
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
        (depths.get(id) ?? 0) > window ? `edge:${side}` : id;
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
      map.ends[side] = state.run
        ? { kind: "loading", count: visited.size - 1 }
        : state.paused
          ? { kind: "paused" }
          : incomplete.size > 0
            ? { kind: "unknown" }
            : folded > 0
              ? { kind: "folded", count: folded }
              : state.expanded &&
                  [...depths.values()].some((depth) => depth > 2)
                ? { kind: "expanded" }
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
    stop(root: string) {
      for (const side of sides) {
        const state = exploration(root, side);
        if (state.run) state.run.active = false;
        state.run = undefined;
      }
    },
    async retry(
      root: string,
      id: string,
      side: BlockingSide,
      since: Moment,
      urgency: () => Urgency | undefined,
      push: () => void,
    ) {
      if (reachable(root, side).has(id))
        await readList(id, side, since, urgency, push);
    },
    activate(
      root: string,
      side: BlockingSide,
      end: BlockingEnd,
      since: Moment,
      urgency: () => Urgency | undefined,
      push: () => void,
    ) {
      const state = exploration(root, side);
      if (state.run) {
        state.run.active = false;
        state.run = undefined;
        push();
        return;
      }
      state.paused = false;
      if (end.kind === "expanded") {
        state.expanded = false;
        push();
        return;
      }
      state.expanded = true;
      const needsRead = (id: string) => {
        if (id !== root && store.get(id)?.state !== "open") return false;
        const known = list(id, side);
        return known
          ? !known.complete || known.problem !== undefined
          : id === root ||
              (store.get(id)?.issueDependenciesSummary[
                side === "blockedBy" ? "totalBlockedBy" : "totalBlocking"
              ] ?? 0) > 0;
      };
      if (![...reachable(root, side)].some(needsRead)) {
        push();
        return;
      }
      const run = { active: true };
      const before = reachable(root, side);
      const remaining = () =>
        40 - [...reachable(root, side)].filter((id) => !before.has(id)).length;
      state.run = run;
      push();
      void (async () => {
        const attempted = new Set<string>();
        const priority = () => (run.active ? urgency() : undefined);
        while (priority() !== undefined) {
          const next = [...reachable(root, side)].find(
            (id) => !attempted.has(id) && needsRead(id),
          );
          if (!next) break;
          attempted.add(next);
          await readList(next, side, since, priority, push, remaining);
          if (run.active && remaining() <= 0) {
            state.paused = true;
            break;
          }
        }
        if (state.run === run) state.run = undefined;
        push();
      })();
    },
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
          // Refresh only the prefix already explored in a partial list.
          // Continue owns the rest, even when another part of the page retries.
          const extents = new Map(
            loaded.map((id) => {
              const known = list(id, side);
              return [
                id,
                known && !known.complete && known.ids.length > 0
                  ? known.ids.length
                  : Infinity,
              ];
            }),
          );
          const revalidate = (id: string) =>
            readList(
              id,
              side,
              since,
              urgency,
              push,
              undefined,
              extents.get(id),
            );
          await revalidate(root);
          const neighbours = (list(root, side)?.ids ?? []).filter(
            (id) => id !== root && store.get(id)?.state === "open",
          );
          await Promise.all(
            [...new Set([...neighbours, ...loaded])]
              .filter((id) => id !== root && store.get(id)?.state === "open")
              .map(revalidate),
          );
        }),
      );
    },
  };
}
