import ELK from "elkjs/lib/elk.bundled.js";
import type {
  BlockingMap,
  BlockingSide,
  IssueSummary,
} from "@verdandi/core/contract";
import type { MapTarget } from "./map-navigation";

const elk = new ELK();
const cardWidth = 216;
const cardHeight = 112;
const columnWidth = 280;
const padding = 28;

export interface MapLayout {
  cards: MapTarget[];
  columns: { step: number; x: number; title: string }[];
  arrows: {
    from: string;
    to: string;
    path: string;
    cycle: boolean;
    closed: boolean;
  }[];
  width: number;
  height: number;
}

export function mapCursorId(issueId: string, root: string): string {
  return issueId === root ? root : `map:${issueId}`;
}

/** ELK orders and positions the cards; the core's signed steps pin the columns. */
export async function layoutBlockingMap(
  map: BlockingMap,
  root: string,
): Promise<MapLayout> {
  const nodes: { id: string; step: number; issue: IssueSummary | undefined }[] =
    map.cards.map(({ issue, step }) => ({
      id: issue.id,
      step,
      issue,
    }));
  const firstColumn = Math.min(-2, ...map.cards.map(({ step }) => step));
  const lastColumn = Math.max(2, ...map.cards.map(({ step }) => step));
  for (const side of ["blockedBy", "blocking"] as const) {
    if (map.ends[side].kind !== "none")
      nodes.push({
        id: `edge:${side}`,
        step: side === "blockedBy" ? firstColumn - 1 : lastColumn + 1,
        issue: undefined,
      });
  }
  const edges = [...map.edges];
  // Unknown branches point to the edge even when nothing has been folded yet.
  for (const card of map.cards) {
    for (const side of ["blockedBy", "blocking"] as const) {
      if (
        !card.badges[side] ||
        card.badges[side].kind === "closed" ||
        map.ends[side].kind === "none"
      )
        continue;
      const from = side === "blockedBy" ? `edge:${side}` : card.issue.id;
      const to = side === "blockedBy" ? card.issue.id : `edge:${side}`;
      if (!edges.some((edge) => edge.from === from && edge.to === to))
        edges.push({ from, to, cycle: false, closed: false });
    }
  }
  const min = Math.min(firstColumn, ...nodes.map(({ step }) => step));
  const max = Math.max(lastColumn, ...nodes.map(({ step }) => step));
  const graph = await elk.layout({
    id: "blocking-map",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.partitioning.activate": "true",
      "elk.spacing.nodeNode": "32",
      "elk.layered.spacing.nodeNodeBetweenLayers": "64",
      "elk.separateConnectedComponents": "false",
      "elk.padding": "[top=0,left=0,bottom=0,right=0]",
    },
    children: nodes.map(({ id, step }) => ({
      id,
      width: cardWidth,
      height: cardHeight,
      layoutOptions: { "elk.partitioning.partition": String(step - min) },
    })),
    edges: edges
      .filter(({ cycle }) => !cycle)
      .map(({ from, to }, index) => ({
        id: `arrow:${String(index)}`,
        sources: [from],
        targets: [to],
      })),
  });
  const x = (step: number) => padding + (step - min) * columnWidth;
  const cards = nodes.map(({ id, step, issue }) => ({
    id: issue ? mapCursorId(id, root) : id,
    issue,
    step,
    x: x(step),
    y: 64 + (graph.children?.find((node) => node.id === id)?.y ?? 0),
    width: cardWidth,
    height: cardHeight,
  }));
  const byId = new Map(nodes.map((node, index) => [node.id, cards[index]]));
  const arrows = edges.flatMap((edge) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) return [];
    const ax = from.x + from.width;
    const ay = from.y + from.height / 2;
    const bx = to.x;
    const by = to.y + to.height / 2;
    const mid = (ax + bx) / 2;
    const top = 44;
    // A long arrow takes the lane above the columns only when a card stands
    // between its ends; past empty columns, such as on the way to an edge
    // card while the map loads, it runs straight.
    const inTheWay = cards.some(
      (card) =>
        card.step > Math.min(from.step, to.step) &&
        card.step < Math.max(from.step, to.step) &&
        card.y < Math.max(ay, by) &&
        card.y + card.height > Math.min(ay, by),
    );
    const path = (
      edge.cycle || inTheWay
        ? [
            "M",
            ax,
            ay,
            "C",
            ax + 36,
            ay,
            ax + 36,
            top,
            ax,
            top,
            "L",
            bx,
            top,
            "C",
            bx - 36,
            top,
            bx - 36,
            by,
            bx,
            by,
          ]
        : ["M", ax, ay, "C", mid, ay, mid, by, bx, by]
    ).join(" ");
    return [{ ...edge, path }];
  });
  return {
    cards,
    arrows,
    width: padding * 2 + (max - min) * columnWidth + cardWidth,
    height: Math.max(
      224,
      ...cards.map((card) => card.y + card.height + padding),
    ),
    columns: Array.from(
      { length: lastColumn - firstColumn + 1 },
      (_, index) => index + firstColumn,
    ).map((step) => ({
      step,
      x: x(step),
      title: columnTitle(step),
    })),
  };
}

function columnTitle(step: number): string {
  switch (step) {
    case -1:
      return "Blocked by";
    case 0:
      return "This issue";
    case 1:
      return "Blocks";
    default:
      return `${String(Math.abs(step))} steps ${step < 0 ? "back" : "on"}`;
  }
}

export function edgeTitle(map: BlockingMap, side: BlockingSide): string {
  const end = map.ends[side];
  switch (end.kind) {
    case "folded":
      return `+${String(end.count)} more`;
    case "expanded":
      return "Fewer";
    case "paused":
      return "Continue…";
    case "loading":
      return `Loading… ${String(end.count)} issues so far`;
    default:
      return "More… · total unknown";
  }
}
