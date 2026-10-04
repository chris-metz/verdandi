import { sidebarWidths } from "@verdandi/core/contract";
import { useState, type ReactNode, type Ref } from "react";
import { cn } from "./lib/utils";
import {
  draggedSidebarWidth,
  keepSidebarWidth,
  useSidebarWidth,
} from "./sidebar-width";

/**
 * The sidebar's column, at the width kept on this machine. Dragging its
 * right edge makes it wider or narrower, and dragging it narrower than it
 * may be hides it, as the View menu's item does, once released: until then,
 * it is only out of sight, and keeps the keyboard if it has it. A double
 * click on the edge gives it the default width again. Its children render
 * only as they change, not as the edge moves.
 */
export function SidebarPane({
  ref,
  hidden,
  className,
  onFocus,
  children,
}: {
  ref: Ref<HTMLElement>;
  /** Whether the sidebar is hidden, as main last said. */
  hidden: boolean;
  className?: string;
  onFocus: () => void;
  children: ReactNode;
}) {
  const kept = useSidebarWidth();
  /** What the drag under way makes of the sidebar so far, if one is. */
  const [dragged, setDragged] = useState<number | "hidden">();
  /** Whether a drag that hid the sidebar was released, until main hides it. */
  const [hiding, setHiding] = useState(false);
  // Hidden, by the drag or otherwise, the sidebar ends any drag.
  if (hidden && (dragged !== undefined || hiding)) {
    setDragged(undefined);
    setHiding(false);
  }
  const shown = hiding ? "hidden" : (dragged ?? kept);

  return (
    <aside
      ref={ref}
      tabIndex={-1}
      onFocus={onFocus}
      style={{ width: shown === "hidden" ? 0 : shown }}
      className={cn(
        "relative shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground outline-none",
        hidden ? "hidden" : "flex",
        shown === "hidden" && "overflow-hidden border-r-0",
        className,
      )}
    >
      {children}
      <div
        role="separator"
        aria-orientation="vertical"
        data-dragging={dragged === undefined ? undefined : ""}
        // The keyboard stays where it is, and no text is selected.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragged(kept);
        }}
        onPointerMove={(event) => {
          if (dragged !== undefined)
            setDragged(draggedSidebarWidth(event.clientX));
        }}
        onPointerUp={() => {
          if (dragged === undefined) return;
          setDragged(undefined);
          if (dragged === "hidden") {
            setHiding(true);
            window.desktop.setSidebarHidden(true);
          } else if (dragged !== kept) {
            keepSidebarWidth(window.verdandi, dragged);
          }
        }}
        onPointerCancel={() => {
          setDragged(undefined);
        }}
        onDoubleClick={() => {
          keepSidebarWidth(window.verdandi, sidebarWidths.default);
        }}
        className="group absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize"
      >
        <div className="absolute inset-y-0 right-[3px] w-0.5 bg-sidebar-ring opacity-0 transition-opacity group-hover:opacity-100 group-data-dragging:opacity-100" />
        {/* Over the whole window while dragging, for the cursor to stay. */}
        {dragged !== undefined && (
          <div className="fixed inset-0 z-50 cursor-col-resize" />
        )}
      </div>
    </aside>
  );
}
