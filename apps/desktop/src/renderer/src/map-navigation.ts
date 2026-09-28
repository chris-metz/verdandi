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
