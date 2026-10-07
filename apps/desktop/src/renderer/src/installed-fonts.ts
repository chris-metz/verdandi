import { useEffect, useState } from "react";
import { shippedFonts } from "../../shared/fonts";
import { cssString } from "./fonts";

/**
 * The font families the user can choose from, by name, in order: those
 * installed as Verdandi started, and those it ships. When the installed ones
 * cannot be listed, only the shipped ones, with why.
 */
export interface FontList {
  families: string[];
  failure?: string;
}

let listing: Promise<FontList> | undefined;

/**
 * Lists the font families the first time it is called, and keeps them: a
 * font installed later is in the list only after a restart, as Chromium
 * keeps its own list for the session. It is called as the page starts, when
 * the window counts as visible, as listing fails while it is hidden.
 */
export function listFonts(): Promise<FontList> {
  if (!listing) {
    listing = installedFaces().then(
      (faces) => ({ families: families(faces.map(({ family }) => family)) }),
      (error: unknown) => ({
        families: families([]),
        failure: error instanceof Error ? error.message : String(error),
      }),
    );
    void listing.then(({ families }) => {
      measureWhenIdle(families);
    });
  }
  return listing;
}

/** The font families, as listed, once they are. */
export function useFonts(): FontList | undefined {
  const [list, setList] = useState<FontList>();
  useEffect(() => {
    let live = true;
    void listFonts().then((listed) => {
      if (live) setList(listed);
    });
    return () => {
      live = false;
    };
  }, []);
  return list;
}

/**
 * The font faces installed. While the window is hidden, or on macOS fully
 * covered, the call fails, and is made again once it shows.
 */
async function installedFaces(): Promise<readonly { family: string }[]> {
  if (!window.queryLocalFonts)
    throw new Error("Electron cannot list the fonts installed.");
  for (;;) {
    try {
      return await window.queryLocalFonts();
    } catch (error) {
      if (document.visibilityState === "visible") throw error;
      await new Promise<void>((resolve) => {
        const shown = () => {
          if (document.visibilityState !== "visible") return;
          document.removeEventListener("visibilitychange", shown);
          resolve();
        };
        document.addEventListener("visibilitychange", shown);
      });
    }
  }
}

/** Each family once, with those Verdandi ships, which are not installed. */
function families(installed: readonly string[]): string[] {
  const names = new Set(installed);
  for (const { family } of Object.values(shippedFonts)) names.add(family);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Tells monospace families apart while the page is idle, a few at a time:
 * measuring a family loads its font, which for every family at once holds
 * the page up for a moment as the code font's list first shows.
 */
function measureWhenIdle(families: readonly string[]) {
  const queue = [...families];
  const measure = (deadline: IdleDeadline) => {
    while (deadline.timeRemaining() > 1) {
      const family = queue.shift();
      if (family === undefined) return;
      isMonospace(family);
    }
    requestIdleCallback(measure);
  };
  requestIdleCallback(measure);
}

const monospaceFamilies = new Map<string, boolean>();
let canvas: CanvasRenderingContext2D | null | undefined;

/**
 * Whether a family's glyphs are all as wide, as a canvas measures narrow and
 * wide letters in it; a family without them measures in a proportional
 * fallback. It may misjudge a family, which only moves it in the list.
 */
export function isMonospace(family: string): boolean {
  // The shipped faces may not be loaded yet, but are known.
  if (family === shippedFonts.codeFont.family) return true;
  if (family === shippedFonts.interfaceFont.family) return false;
  let known = monospaceFamilies.get(family);
  if (known === undefined) {
    canvas ??= document.createElement("canvas").getContext("2d");
    if (!canvas) return false;
    canvas.font = `16px ${cssString(family)}, sans-serif`;
    const narrow = canvas.measureText("iiiiiiiiii").width;
    const wide = canvas.measureText("MMMMMMMMMM").width;
    known = Math.abs(narrow - wide) < 0.5;
    monospaceFamilies.set(family, known);
  }
  return known;
}
