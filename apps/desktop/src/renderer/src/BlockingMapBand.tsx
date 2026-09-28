import type {
  BlockingBadge,
  BlockingMap,
  BlockingSide,
} from "@verdandi/core/contract";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { IssueStateIcon } from "./IssueStateIcon";
import {
  edgeTitle,
  layoutBlockingMap,
  type MapLayout,
} from "./blocking-layout";
import type { IssueDestination } from "./issue-navigation";
import {
  mapScrollAfterLayout,
  revealMapCard,
  type MapTarget,
} from "./map-navigation";
import { LoaderCircle, LockKeyhole, Pause } from "lucide-react";

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
  onActivateEnd,
  onRetryBranch,
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
  onActivateEnd: (side: BlockingSide) => void;
  onRetryBranch: (id: string, side: BlockingSide) => void;
}) {
  const [layout, setLayout] = useState<MapLayout>();
  const [failed, setFailed] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  const initialScroll = useRef(savedScrollLeft);
  const previousCursor = useRef(cursor);
  const previousLayout = useRef<MapLayout>(undefined);
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
    if (!element || !centre || !layout) return;
    const previous = previousLayout.current;
    if (!restored.current) {
      element.scrollLeft =
        initialScroll.current ??
        centre.x + centre.width / 2 - element.clientWidth / 2;
      restored.current = true;
    } else if (previous) {
      element.scrollLeft = mapScrollAfterLayout(
        previous.cards,
        layout.cards,
        root,
        cursor,
        element.scrollLeft,
        element.clientWidth,
      );
    }
    if (cursor !== previousCursor.current) {
      const card = layout.cards.find(({ id }) => id === cursor);
      if (card)
        element.scrollLeft = revealMapCard(
          card,
          element.scrollLeft,
          element.clientWidth,
        );
    }
    if (
      previous &&
      previous !== layout &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      const before = new Map(previous.cards.map((card) => [card.id, card]));
      for (const card of layout.cards) {
        if (!card.issue) continue;
        const old = before.get(card.id);
        const colour = !old
          ? "rgb(46 160 67 / 30%)"
          : old.step !== card.step
            ? "rgb(210 153 34 / 35%)"
            : undefined;
        if (!colour) continue;
        const flash = element.querySelector<HTMLElement>(
          `[data-map-card="${CSS.escape(card.id)}"] > .map-flash`,
        );
        for (const animation of flash?.getAnimations() ?? [])
          animation.cancel();
        flash?.animate(
          [{ backgroundColor: colour }, { backgroundColor: "transparent" }],
          { duration: 1800, easing: "ease-out" },
        );
      }
    }
    previousLayout.current = layout;
    previousCursor.current = cursor;
  }, [layout, root, cursor]);
  const centreX = layout?.cards.find(({ id }) => id === root)?.x ?? 0;
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
            className="relative overflow-hidden"
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
                <div
                  key={position.id}
                  data-map-card={position.id}
                  data-issue-id={issue?.id}
                  data-page-cursor={selected}
                  className={cn("absolute", issue && "map-card")}
                  style={{
                    left: centreX,
                    top: 0,
                    transform: `translate(${String(position.x - centreX)}px, ${String(position.y)}px)`,
                    width: position.width,
                    height: position.height,
                  }}
                >
                  <button
                    type="button"
                    aria-label={
                      issue
                        ? `${issue.reference}: ${issue.title}`
                        : edgeTitle(map, side)
                    }
                    aria-current={selected ? "true" : undefined}
                    className={cn(
                      "flex size-full flex-col rounded-lg border bg-background px-3 py-2.5 text-left text-xs shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected && "ring-2 ring-selection-edge",
                      external && "border-dashed",
                      blocked && "border-l-[3px] border-l-blocked",
                      issue?.state === "closed" && "opacity-55",
                      !issue &&
                        "justify-center border-dashed text-muted-foreground",
                    )}
                    title={
                      issue?.title ??
                      (map.ends[side].kind === "loading"
                        ? "Click or press Enter to stop"
                        : undefined)
                    }
                    onClick={() => {
                      onSelect(position.id);
                      if (issue) onOpen(issue);
                      else onActivateEnd(side);
                    }}
                  >
                    {issue ? (
                      <>
                        <span className="mb-2 flex w-full items-center gap-1.5 text-muted-foreground">
                          <IssueStateIcon
                            state={issue.state}
                            blocked={blocked}
                          />
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
                      </>
                    ) : (
                      <span>{edgeTitle(map, side)}</span>
                    )}
                  </button>
                  <span
                    aria-hidden
                    className="map-flash pointer-events-none absolute inset-0 rounded-lg"
                  />
                  {card &&
                    (["blockedBy", "blocking"] as const).map((direction) => {
                      const badge = card.badges[direction];
                      return (
                        badge && (
                          <BranchBadge
                            key={direction}
                            badge={badge}
                            side={direction}
                            onRetry={() => {
                              onSelect(position.id);
                              onRetryBranch(card.issue.id, direction);
                            }}
                          />
                        )
                      );
                    })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function BranchBadge({
  badge,
  side,
  onRetry,
}: {
  badge: BlockingBadge;
  side: BlockingSide;
  onRetry: () => void;
}) {
  const className = cn(
    "absolute -top-2 flex items-center gap-1 rounded-full border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground",
    side === "blockedBy" ? "-left-2" : "-right-2",
    badge.kind === "failed" && "border-blocked/50 text-blocked",
  );
  if (badge.kind === "failed")
    return (
      <button
        type="button"
        className={className}
        onClick={onRetry}
        aria-label={`Retry ${side === "blockedBy" ? "blockers" : "waiting issues"} for this branch`}
      >
        ! Retry
      </button>
    );
  const label =
    badge.kind === "closed"
      ? "Closed issue: relationships not followed"
      : badge.kind === "loading"
        ? "Loading relationships"
        : badge.kind === "paused"
          ? "Waiting for the rate-limit reset shown in the header"
          : badge.kind === "inaccessible"
            ? `${String(badge.count)} relationships not visible to you`
            : `${String(badge.count)} relationships not loaded`;
  return (
    <span className={className} title={label} aria-label={label}>
      {badge.kind === "closed" ? (
        "⋯"
      ) : badge.kind === "loading" ? (
        <LoaderCircle className="size-3 animate-spin" aria-hidden />
      ) : badge.kind === "paused" ? (
        <Pause className="size-3" aria-hidden />
      ) : badge.kind === "inaccessible" ? (
        <>
          <LockKeyhole className="size-3" aria-hidden />
          {badge.count}
        </>
      ) : (
        `+${String(badge.count)}`
      )}
    </span>
  );
}
