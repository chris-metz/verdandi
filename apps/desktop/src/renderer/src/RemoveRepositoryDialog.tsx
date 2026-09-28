import type {
  TrackedRepository,
  SidebarSelection,
} from "@verdandi/core/contract";
import { useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { repositoryLabel } from "./scope";

/** Confirmation is shared by the context menu and the sidebar's ⌫ key. */
export function RemoveRepositoryDialog({
  repository,
  returnFocus,
  onRemove,
  onRemoved,
  onClose,
}: {
  repository: TrackedRepository;
  returnFocus: RefObject<HTMLElement | null>;
  onRemove: () => ReturnType<typeof window.verdandi.removeRepository>;
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
        <DialogTitle className="leading-snug break-words">
          Remove {repositoryLabel(repository)} from Verdandi?
        </DialogTitle>
        <DialogDescription>
          Nothing on GitHub changes. Its issues leave All; views are not
          changed. You can add it again at any time.
        </DialogDescription>
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
