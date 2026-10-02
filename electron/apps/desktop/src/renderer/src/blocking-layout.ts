import ELK from "elkjs/lib/elk.bundled.js";
import type {
  BlockingMap,
  BlockingSide,
  IssueSummary,
} from "@verdandi/core/contract";
import type { MapTarget } from "./map-navigation";
import { baseTextSize } from "./text-size";

const elk = new ELK();
/** Around the map, whatever the text size. */
const padding = 28;
/** Where the column titles start, below the top of the map. */
const titleTop = 20;

/**
 * The map's sizes for text of `textSize` pixels. What holds text grows and
 * shrinks with it: each card's header line and two lines of title, and the
 * gaps between cards and columns. The padding around the map and in a
 * card, its icons and the dots of its labels stay.
 */
export function mapSizes(textSize: number) {
  const scale = textSize / baseTextSize;
  /** A size of which `text` pixels at `baseTextSize` grow with the text. */
  const size = (fixed: number, text: number) =>
    Math.round(fixed + text * scale);
  const cardWidth = size(26, 190);
  const cardHeight = size(64, 48);
  // The cards start below the column titles and the lane above them.
  const cardTop = size(titleTop, 44);
  return {
    cardWidth,
    cardHeight,
    /** From one column to the next: a card and the gap after it. */
    columnWidth: cardWidth + size(0, 64),
    /** Between the cards of a column. */
    cardGap: size(0, 32),
    cardTop,
    /** Where a long arrow runs above the columns, below their titles. */
    laneTop: size(titleTop, 24),
    /** How far a long arrow curves out of a card to reach the lane. */
    curve: size(0, 36),
    /**
     * The smallest map, a row of cards with room below it, which the band
     * keeps free while it is first laid out.
     */
    minimumHeight: cardTop + cardHeight + 48,
  };
}

export interface MapLayout {
  cards: MapTarget[];
  columns: { step: number; x: number; y: number; title: string }[];
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

/**
 * ELK orders and positions the cards; the core's signed steps pin the
 * columns. Its sizes are for text of `textSize` pixels.
 */
export async function layoutBlockingMap(
  map: BlockingMap,
  root: string,
  textSize: number,
): Promise<MapLayout> {
  const {
    cardWidth,
    cardHeight,
    columnWidth,
    cardGap,
    cardTop,
    laneTop,
    curve,
    minimumHeight,
  } = mapSizes(textSize);
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
      "elk.spacing.nodeNode": String(cardGap),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(
        columnWidth - cardWidth,
      ),
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
    y: cardTop + (graph.children?.find((node) => node.id === id)?.y ?? 0),
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
            ax + curve,
            ay,
            ax + curve,
            laneTop,
            ax,
            laneTop,
            "L",
            bx,
            laneTop,
            "C",
            bx - curve,
            laneTop,
            bx - curve,
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
      minimumHeight,
      ...cards.map((card) => card.y + card.height + padding),
    ),
    columns: Array.from(
      { length: lastColumn - firstColumn + 1 },
      (_, index) => index + firstColumn,
    ).map((step) => ({
      step,
      x: x(step),
      y: titleTop,
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
