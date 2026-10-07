import type { IssueDestination } from "./issue-navigation";

export interface MapTarget {
  id: string;
  /** The core column, with zero identifying this issue. */
  step: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Edge cards have no destination. */
  issue?: IssueDestination | undefined;
}

/** Keeps identity; a vanished card falls back by distance from the anchored root. */
export function retainMapCursor(
  before: readonly MapTarget[],
  after: readonly MapTarget[],
  cursor: string,
): string | undefined {
  if (after.some(({ id }) => id === cursor)) return cursor;
  const previous = before.find(({ id }) => id === cursor);
  if (!previous) return undefined;
  const oldRoot = before.find(({ step }) => step === 0);
  const newRoot = after.find(({ step }) => step === 0);
  const x =
    previous.x + previous.width / 2 + (newRoot?.x ?? 0) - (oldRoot?.x ?? 0);
  const y =
    previous.y + previous.height / 2 + (newRoot?.y ?? 0) - (oldRoot?.y ?? 0);
  const distance = (card: MapTarget) =>
    Math.hypot(card.x + card.width / 2 - x, card.y + card.height / 2 - y);
  return [...after].sort((a, b) => distance(a) - distance(b))[0]?.id;
}

export function revealMapCard(
  card: MapTarget,
  left: number,
  width: number,
): number {
  if (card.x < left) return Math.max(0, card.x - 16);
  if (card.x + card.width > left + width)
    return card.x + card.width - width + 16;
  return left;
}

/** Holds the root on screen, then makes room for a cursor moving relative to it. */
export function mapScrollAfterLayout(
  before: readonly MapTarget[],
  after: readonly MapTarget[],
  root: string,
  cursor: string,
  left: number,
  width: number,
): number {
  const oldRoot = before.find(({ id }) => id === root);
  const newRoot = after.find(({ id }) => id === root);
  const shift = oldRoot && newRoot ? newRoot.x - oldRoot.x : 0;
  const anchored = Math.max(0, left + shift);
  const previous = before.find(({ id }) => id === cursor);
  const current = after.find(({ id }) => id === cursor);
  return current && previous && current.x - previous.x !== shift
    ? revealMapCard(current, anchored, width)
    : anchored;
}

/** Horizontal moves choose the next column, then its closest card. */
export function spatialNeighbour(
  cards: readonly MapTarget[],
  cursor: string,
  direction: "left" | "right" | "up" | "down",
): string | undefined {
  const current = cards.find(({ id }) => id === cursor);
  if (!current) return undefined;
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "left" || direction === "up" ? -1 : 1;
  const candidates = cards.filter((card) =>
    horizontal
      ? (card.x - current.x) * sign > 0
      : card.x === current.x && (card.y - current.y) * sign > 0,
  );
  candidates.sort((a, b) => {
    if (!horizontal)
      return Math.abs(a.y - current.y) - Math.abs(b.y - current.y);
    return (
      Math.abs(a.x - current.x) - Math.abs(b.x - current.x) ||
      Math.abs(a.y + a.height / 2 - current.y - current.height / 2) -
        Math.abs(b.y + b.height / 2 - current.y - current.height / 2)
    );
  });
  return candidates[0]?.id;
}

export function directionForKey(
  key: string,
): "left" | "right" | "up" | "down" | undefined {
  switch (key) {
    case "h":
    case "ArrowLeft":
      return "left";
    case "l":
    case "ArrowRight":
      return "right";
    case "k":
    case "ArrowUp":
      return "up";
    case "j":
    case "ArrowDown":
      return "down";
    default:
      return undefined;
  }
}
