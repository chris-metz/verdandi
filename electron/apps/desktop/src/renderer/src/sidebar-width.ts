import { sidebarWidths } from "@verdandi/core/contract";
import { useSyncExternalStore } from "react";
import type { RendererContract } from "../../shared/ipc";

/** The sidebar's width, as kept on this machine. */
let kept: number = sidebarWidths.default;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function set(width: number) {
  if (width === kept) return;
  kept = width;
  for (const notify of listeners) notify();
}

/**
 * Reads the sidebar's width as it was kept last on this machine. It settles
 * once read, or once that has failed, when the sidebar has the default width.
 */
export function readSidebarWidth(
  verdandi: Pick<RendererContract, "getSidebarWidth">,
): Promise<void> {
  return verdandi.getSidebarWidth().then(set, () => undefined);
}

/** Gives the sidebar a width, and keeps it on this machine. */
export function keepSidebarWidth(
  verdandi: Pick<RendererContract, "saveSidebarWidth">,
  width: number,
) {
  set(width);
  void verdandi.saveSidebarWidth(width).catch(() => undefined);
}

/** The sidebar's width, as kept on this machine. */
export function useSidebarWidth(): number {
  return useSyncExternalStore(subscribe, () => kept);
}

/**
 * What dragging the sidebar's edge makes of it, with the pointer `pointer`
 * pixels from the window's left edge: a width in whole pixels within
 * `sidebarWidths`, or hidden, once the pointer is below half the narrowest.
 */
export function draggedSidebarWidth(pointer: number): number | "hidden" {
  const { narrowest, widest } = sidebarWidths;
  if (pointer < narrowest / 2) return "hidden";
  return Math.round(Math.min(Math.max(pointer, narrowest), widest));
}
