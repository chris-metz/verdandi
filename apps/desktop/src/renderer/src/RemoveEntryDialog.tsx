import type { SidebarSelection } from "@verdandi/core/contract";
import { useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { repositoryLabel, type SidebarScope } from "./scope";

/** A sidebar entry that can be removed: a tracked repository or a view. */
export type RemovableEntry = Exclude<SidebarScope, { kind: "all" }>;

/**
 * The confirmation every removal of a sidebar entry goes through, from its
 * context menu, the sidebar's ⌫ key, or the view dialog.
 */
export function RemoveEntryDialog({
  entry,
  returnFocus,
  onRemove,
  onRemoved,
  onClose,
}: {
  entry: RemovableEntry;
  returnFocus: RefObject<HTMLElement | null>;
  onRemove: () => Promise<
    { ok: true; selection: SidebarSelection } | { ok: false; message: string }
  >;
  onRemoved: (selection: SidebarSelection) => void;
  onClose: () => void;
}) {
  const removeButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await onRemove();
      if (result.ok) onRemoved(result.selection);
      else setError(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={removeButton}
        finalFocus={() => {
          // Base UI otherwise prefers the pane's first tabbable child (+).
          // Restore the pane itself after the dialog releases its focus trap.
          queueMicrotask(() =>
            returnFocus.current?.focus({ preventScroll: true }),
          );
          return false;
        }}
      >
        {entry.kind === "repository" ? (
          <>
            <DialogTitle className="leading-snug break-words">
              Remove {repositoryLabel(entry.repository)} from Verdandi?
            </DialogTitle>
            <DialogDescription>
              Nothing on GitHub changes. Its issues leave All; views are not
              changed. You can add it again at any time.
            </DialogDescription>
          </>
        ) : (
          <>
            <DialogTitle className="leading-snug break-words">
              Remove the view “{entry.view.name}”?
            </DialogTitle>
            <DialogDescription>
              Its name and search are deleted from your settings. Tracked
              repositories and issues are not affected. This can’t be undone.
            </DialogDescription>
          </>
        )}
        {error && (
          <p role="alert" className="break-words text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            ref={removeButton}
            variant="destructive"
            disabled={busy}
            onClick={() => {
              void remove();
            }}
          >
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
