import type { BlockingMap, BlockingSide } from "@verdandi/core/contract";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { IssueStateIcon } from "./IssueStateIcon";
import {
  edgeTitle,
  layoutBlockingMap,
  type MapLayout,
} from "./blocking-layout";
import type { IssueDestination } from "./issue-navigation";
import type { MapTarget } from "./map-navigation";

export function BlockingMapBand({
  map,
  root,
  cursor,
  savedScrollLeft,
  onScroll,
  onLayout,
  onSelect,
  onOpen,
  onRetry,
}: {
  map: BlockingMap;
  root: string;
  cursor: string;
  savedScrollLeft: number | undefined;
  onScroll: (left: number) => void;
  onLayout: (cards: readonly MapTarget[]) => void;
  onSelect: (id: string) => void;
  onOpen: (issue: IssueDestination) => void;
  onRetry: () => void;
}) {
  const [layout, setLayout] = useState<MapLayout>();
  const [failed, setFailed] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  const initialScroll = useRef(savedScrollLeft);
  const previousCursor = useRef(cursor);
  const centreX = useRef<number>(undefined);
  const marker = useId().replace(/:/g, "");
  useEffect(() => {
    let active = true;
    void layoutBlockingMap(map, root)
      .then((next) => {
        if (active) {
          setLayout(next);
          setFailed(false);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [map, root]);
  useLayoutEffect(() => {
    if (layout) onLayout(layout.cards);
  }, [layout, onLayout]);
  useLayoutEffect(() => {
    const element = scroller.current;
    const centre = layout?.cards.find(({ id }) => id === root);
    if (!element || !centre) return;
    if (!restored.current) {
      element.scrollLeft =
        initialScroll.current ??
        centre.x + centre.width / 2 - element.clientWidth / 2;
      restored.current = true;
    } else if (centreX.current !== undefined) {
      element.scrollLeft += centre.x - centreX.current;
    }
    centreX.current = centre.x;
  }, [layout, root]);
  useLayoutEffect(() => {
    if (cursor === previousCursor.current) return;
    previousCursor.current = cursor;
    const element = scroller.current;
    const card = layout?.cards.find(({ id }) => id === cursor);
    if (!element || !card) return;
    if (card.x < element.scrollLeft) element.scrollLeft = card.x - 16;
    else if (card.x + card.width > element.scrollLeft + element.clientWidth)
      element.scrollLeft = card.x + card.width - element.clientWidth + 16;
  }, [cursor, layout]);
  const visible = new Map(map.cards.map((card) => [card.issue.id, card]));
  return (
    <section aria-label="Blocking map" className="border-t bg-muted/20">
      {map.problems.length > 0 && (
        <p role="status" className="px-6 pt-3 text-xs text-muted-foreground">
          Some blocking relationships could not be loaded.{" "}
          <button className="underline" onClick={onRetry}>
            Retry
          </button>
        </p>
      )}
      {failed && (
        <p role="status" className="px-6 py-3">
          The blocking map could not be laid out.{" "}
          <button className="underline" onClick={onRetry}>
            Retry
          </button>
        </p>
      )}
      <div
        ref={scroller}
        data-map-scroll
        className="overflow-x-auto"
        onScroll={(event) => {
          event.stopPropagation();
          if (restored.current) onScroll(event.currentTarget.scrollLeft);
        }}
      >
        {!layout ? (
          <p className="px-6 py-8 text-muted-foreground">
            Laying out blocking map…
          </p>
        ) : (
          <div
            className="relative"
            style={{ width: layout.width, height: layout.height }}
          >
            {layout.columns.map((column) => (
              <div
                key={column.step}
                className="absolute top-5 text-[11px] font-medium tracking-wide text-muted-foreground"
                style={{ left: column.x }}
              >
                {column.title}
              </div>
            ))}
            <svg
              width={layout.width}
              height={layout.height}
              className="pointer-events-none absolute inset-0 overflow-visible"
              aria-hidden
            >
              <defs>
                <marker
                  id={`${marker}-arrow`}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path
                    d="M 0 0 L 10 5 L 0 10 z"
                    className="fill-muted-foreground"
                  />
                </marker>
                <marker
                  id={`${marker}-cycle`}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" className="fill-blocked" />
                </marker>
              </defs>
              {layout.arrows.map((arrow) => (
                <path
                  key={`${arrow.from}:${arrow.to}`}
                  d={arrow.path}
                  fill="none"
                  strokeWidth="1.5"
                  className={
                    arrow.cycle
                      ? "stroke-blocked"
                      : "stroke-muted-foreground/50"
                  }
                  strokeDasharray={
                    arrow.cycle ? "2 4" : arrow.closed ? "6 5" : undefined
                  }
                  markerEnd={`url(#${marker}-${arrow.cycle ? "cycle" : "arrow"})`}
                />
              ))}
            </svg>
            {layout.cards.map((position) => {
              const card = position.issue && visible.get(position.issue.id);
              if (position.issue && !card) return null;
              const issue = card?.issue;
              const selected = cursor === position.id;
              const blocked =
                issue?.state === "open" && issue.blockedBy.open > 0;
              const external = issue?.external;
              const rootRepository = visible.get(root)?.issue.repository;
              const differentRepository =
                issue &&
                (external ||
                  issue.repository.owner !== rootRepository?.owner ||
                  issue.repository.name !== rootRepository.name);
              const side: BlockingSide =
                position.step < 0 ? "blockedBy" : "blocking";
              return (
                <button
                  key={position.id}
                  type="button"
                  data-map-card={position.id}
                  data-issue-id={issue?.id}
                  data-page-cursor={selected}
                  aria-label={
                    issue
                      ? `${issue.reference}: ${issue.title}`
                      : edgeTitle(map, side)
                  }
                  aria-current={selected ? "true" : undefined}
                  className={cn(
                    "absolute flex flex-col rounded-lg border bg-background px-3 py-2.5 text-left text-xs shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected && "ring-2 ring-selection-edge",
                    external && "border-dashed",
                    blocked && "border-l-[3px] border-l-blocked",
                    issue?.state === "closed" && "opacity-55",
                    !issue &&
                      "justify-center border-dashed text-muted-foreground",
                  )}
                  style={{
                    left: position.x,
                    top: position.y,
                    width: position.width,
                    height: position.height,
                  }}
                  title={issue?.title}
                  onClick={() => {
                    onSelect(position.id);
                    if (issue) onOpen(issue);
                  }}
                >
                  {issue ? (
                    <>
                      <span className="mb-2 flex w-full items-center gap-1.5 text-muted-foreground">
                        <IssueStateIcon state={issue.state} blocked={blocked} />
                        {differentRepository && (
                          <span
                            className={cn(
                              "max-w-36 truncate rounded px-1 py-0.5 text-[10px]",
                              external ? "border" : "bg-muted",
                            )}
                            title={`${issue.repository.owner}/${issue.repository.name}`}
                          >
                            {issue.repository.owner}/{issue.repository.name}
                          </span>
                        )}
                        <span className="ml-auto shrink-0 tabular-nums">
                          #{issue.reference.split("#").at(-1)}
                        </span>
                      </span>
                      <span className="line-clamp-2 leading-4 font-medium">
                        {issue.title}
                      </span>
                      <span className="mt-auto flex gap-1 pt-2">
                        {issue.labels.map((label) => (
                          <span
                            key={label.name}
                            title={label.name}
                            aria-label={label.name}
                            className="size-2 rounded-full ring-1 ring-black/10"
                            style={{ backgroundColor: `#${label.color}` }}
                          />
                        ))}
                      </span>
                      {(["blockedBy", "blocking"] as const).map((direction) => {
                        const badge = card.badges[direction];
                        if (!badge) return null;
                        return (
                          <span
                            key={direction}
                            className={cn(
                              "absolute -top-2 rounded-full border bg-background px-1.5 text-[10px] text-muted-foreground",
                              direction === "blockedBy"
                                ? "-left-2"
                                : "-right-2",
                            )}
                            title={
                              badge.kind === "closed"
                                ? "Closed issue: relationships not followed"
                                : `${String(badge.count)} relationships not loaded`
                            }
                          >
                            {badge.kind === "closed"
                              ? "⋯"
                              : `+${String(badge.count)}`}
                          </span>
                        );
                      })}
                    </>
                  ) : (
                    <span>{edgeTitle(map, side)}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
