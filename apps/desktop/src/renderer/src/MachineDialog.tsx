import { defaultCheckoutFolders, type Host } from "@verdandi/core/contract";
import { Info } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** What the machine dialog is open for. */
export type MachineDialogPurpose =
  | { kind: "new-host" }
  | { kind: "host"; host: Host }
  | { kind: "this"; name: string; folders: readonly string[] };

const field =
  "h-line-8 rounded-md border bg-background px-2.5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * The dialog that adds a host to Checkouts, or changes one, its name,
 * address and folders, or this machine's folders. Save writes them at once
 * and the machine is read again; a host can be removed from here. ↵ saves,
 * Esc cancels.
 */
export function MachineDialog({
  purpose,
  onClose,
}: {
  purpose: MachineDialogPurpose;
  onClose: () => void;
}) {
  const host = purpose.kind === "host" ? purpose.host : undefined;
  const [name, setName] = useState(host?.name ?? "");
  const [address, setAddress] = useState(host?.address ?? "");
  const [folders, setFolders] = useState(
    (purpose.kind === "new-host"
      ? defaultCheckoutFolders
      : purpose.kind === "host"
        ? purpose.host.folders
        : purpose.folders
    ).join(", "),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [removing, setRemoving] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  /** Runs a change, closing once it is written, and saying why it was not. */
  async function act(
    change: () => Promise<{ ok: true } | { ok: false; message: string }>,
  ) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await change();
      if (result.ok) {
        onClose();
        return;
      }
      setError(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    setBusy(false);
  }

  function save() {
    const list = folders.split(",");
    void act(async () => {
      if (purpose.kind === "this")
        return window.verdandi.setCheckoutFolders(list);
      const saved = await window.verdandi.saveHost({
        ...(host ? { id: host.id } : {}),
        name,
        address,
        folders: list,
      });
      return saved.status === "saved"
        ? { ok: true }
        : { ok: false, message: saved.message };
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      save();
    }
  }

  const title =
    purpose.kind === "new-host"
      ? "Add host"
      : purpose.kind === "host"
        ? `Change ${purpose.host.name}`
        : `${purpose.name}’s folders`;

  return (
    <Dialog
      open
      disablePointerDismissal={busy}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={firstField}
        onKeyDown={onKeyDown}
        className="flex max-h-[calc(100%-3rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <DialogTitle>{title}</DialogTitle>
          <kbd className="rounded border border-b-2 px-1 font-mono text-2xs text-muted-foreground">
            Esc
          </kbd>
        </div>
        <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto px-4 pb-4">
          {purpose.kind !== "this" && (
            <>
              <label htmlFor="host-name" className="text-xs font-medium">
                Name
              </label>
              <input
                id="host-name"
                ref={firstField}
                value={name}
                placeholder="NUC"
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => {
                  setName(event.target.value);
                }}
                className={field}
              />
              <label
                htmlFor="host-address"
                className="mt-2 text-xs font-medium"
              >
                SSH address
              </label>
              <input
                id="host-address"
                value={address}
                placeholder="nuc.example.ts.net"
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => {
                  setAddress(event.target.value);
                }}
                className={cn(
                  field,
                  "font-mono text-[calc(13px*var(--text-scale))]",
                )}
              />
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info aria-hidden className="mt-px size-3.5 shrink-0" />
                <span>
                  What you would type after <code>ssh</code>. Verdandi logs in
                  without asking for anything, so the host must let you in
                  without a key, as Tailscale SSH does through the host’s
                  Tailscale name.
                </span>
              </p>
            </>
          )}
          <label
            htmlFor="machine-folders"
            className={cn(
              "text-xs font-medium",
              purpose.kind !== "this" && "mt-2",
            )}
          >
            Folders
          </label>
          <input
            id="machine-folders"
            ref={purpose.kind === "this" ? firstField : undefined}
            value={folders}
            placeholder="~/code"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setFolders(event.target.value);
            }}
            className={cn(
              field,
              "font-mono text-[calc(13px*var(--text-scale))]",
            )}
          />
          <p className="text-xs text-muted-foreground">
            Where its checkouts are, separated by commas. Verdandi looks a few
            levels deep in each.
          </p>
          {error && (
            <p
              role="alert"
              className="mt-1 text-xs break-words text-destructive"
            >
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="m-0 items-center">
          {host &&
            (removing ? (
              <span className="flex items-center gap-2 sm:mr-auto">
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    void act(() => window.verdandi.removeHost(host.id));
                  }}
                >
                  Remove {host.name}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setRemoving(false);
                  }}
                >
                  Keep
                </Button>
              </span>
            ) : (
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  setRemoving(true);
                }}
                className="sm:mr-auto"
              >
                Remove host…
              </Button>
            ))}
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={save}>
            Save
            <kbd className="font-mono text-2xs opacity-70">↵</kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
