import type { RenewedMediaLinks } from "@verdandi/core/contract";
import { freshLink, mediaSource } from "./media";
import {
  imageAltAttribute,
  loadImageAttribute,
  mediaImage,
  mediaPlaceholder,
  mediumName,
  openOnGitHubAttribute,
  retryMediaAttribute,
  thirdPartyPlaceholder,
  type OwnButton,
} from "./own-elements";

/** An image or video a body shows, as Verdandi loads it. */
type Medium = HTMLImageElement | HTMLVideoElement;

export interface MediaLoadingOptions {
  /**
   * Reads the body again for fresh links to its media, answering with its
   * HTML, or with why it could not be read.
   */
  renew: () => Promise<RenewedMediaLinks>;
  /** Says briefly why the body could not be read again. */
  describe: (
    failed: Extract<RenewedMediaLinks, { status: "failed" }>,
  ) => string;
  /**
   * Loads an image from elsewhere than GitHub's media hosts, once the user
   * asked, answering with an address that shows it, or why it could not.
   */
  loadImage: (url: string) => Promise<ThirdPartyImage>;
}

/** An image from elsewhere, loaded where it shows, or why it could not be. */
export type ThirdPartyImage =
  { status: "loaded"; url: string } | { status: "failed"; reason: string };

/**
 * A medium that fails within this long, in milliseconds, of loading once
 * more with a fresh link shows as a placeholder: fresh links did not help.
 * One that fails later, e.g. a video played on after its link expired
 * again, gets a fresh link again.
 */
const silentRetryEvery = 60 * 1000;

const openOnGitHub: OwnButton = {
  label: "Open on GitHub",
  attribute: openOnGitHubAttribute,
};

/**
 * Follows the images and videos of a body as they load, until the returned
 * function is called.
 *
 * - An image never shows above its own size, whatever size GitHub gives it.
 * - One from GitHub's media hosts that fails to load, e.g. once GitHub's
 *   signature in its link has expired, has the body read again for a fresh
 *   link, and loads once more with it; a video goes on where it was. The
 *   media that fail meanwhile share that read.
 * - One that fails again, or whose body could not be read again, shows as a
 *   placeholder that says why, with **Retry** and **Open on GitHub**. Retry
 *   reads the body again, unless that was a minute ago, and loads it once
 *   more. Nothing else of the body changes.
 * - An image from elsewhere than GitHub's media hosts loads when its
 *   placeholder's **Load image** is clicked.
 */
export function followMedia(
  body: HTMLElement,
  options: MediaLoadingOptions,
): () => void {
  /** When each medium last loaded once more with a fresh link. */
  const retriedAt = new WeakMap<Medium, number>();
  /** Where each video was, and whether it played, when it failed. */
  const positions = new WeakMap<
    HTMLVideoElement,
    { time: number; playing: boolean }
  >();
  /** The placeholder each medium that failed shows as. */
  const placeholders = new WeakMap<Medium, HTMLElement>();
  /** The medium each placeholder stands for. */
  const media = new WeakMap<HTMLElement, Medium>();
  /** The media waiting for the body to be read again. */
  const waiting = new Set<Medium>();
  let renewing = false;
  let followed = true;

  function onError(event: Event) {
    const medium = event.target;
    if (
      !(
        medium instanceof HTMLImageElement || medium instanceof HTMLVideoElement
      ) ||
      !medium.matches(".media-image, .media-video")
    ) {
      return;
    }
    const kind = medium instanceof HTMLImageElement ? "image" : "video";
    // An image loaded from elsewhere has no link GitHub could renew.
    if (mediaSource(kind, medium.getAttribute("src") ?? "").kind !== "github") {
      fail(medium, "Could not be shown", [openOnGitHub]);
      return;
    }
    if (medium instanceof HTMLVideoElement) {
      positions.set(medium, {
        time: medium.currentTime,
        playing: !medium.paused,
      });
    }
    const retried = retriedAt.get(medium);
    if (retried !== undefined && Date.now() - retried < silentRetryEvery) {
      fail(medium, failure(medium));
      return;
    }
    renewThenLoad(medium);
  }

  /** Why a medium failed to load with a fresh link. */
  function failure(medium: Medium): string {
    return medium instanceof HTMLVideoElement &&
      medium.error?.code === MediaError.MEDIA_ERR_DECODE
      ? "Could not be played"
      : "Could not be loaded";
  }

  /**
   * Has the body read again, with every medium waiting for it, then loads
   * each once more with its fresh link.
   */
  function renewThenLoad(medium: Medium) {
    retriedAt.set(medium, Date.now());
    waiting.add(medium);
    if (renewing) return;
    renewing = true;
    void options
      .renew()
      .catch((): RenewedMediaLinks => ({
        status: "failed",
        problem: { kind: "interrupted" },
      }))
      .then((renewed) => {
        renewing = false;
        const those = [...waiting];
        waiting.clear();
        if (!followed) return;
        for (const one of those) {
          if (renewed.status === "failed") {
            fail(one, options.describe(renewed));
            continue;
          }
          const failedLink = one.getAttribute("src") ?? "";
          const url = freshLink(failedLink, renewed.bodyHTML);
          if (url === undefined) fail(one, "No longer in the body");
          else load(one, url);
        }
      });
  }

  /** Loads a medium once more, where it showed, going on where it was. */
  function load(medium: Medium, url: string) {
    const placeholder = placeholders.get(medium);
    if (placeholder) replaceKeepingFocus(placeholder, medium);
    placeholders.delete(medium);
    const position =
      medium instanceof HTMLVideoElement ? positions.get(medium) : undefined;
    if (medium instanceof HTMLVideoElement && position) {
      medium.addEventListener(
        "loadedmetadata",
        () => {
          medium.currentTime = position.time;
          if (position.playing) void medium.play().catch(() => undefined);
        },
        { once: true },
      );
    }
    medium.setAttribute("src", url);
  }

  /** Shows a placeholder where a medium was, saying why it failed. */
  function fail(
    medium: Medium,
    reason: string,
    buttons: OwnButton[] = [
      { label: "Retry", attribute: retryMediaAttribute },
      openOnGitHub,
    ],
  ) {
    const name =
      medium instanceof HTMLImageElement
        ? mediumName("Image", medium.alt)
        : mediumName("Video", medium.getAttribute("aria-label") ?? "");
    const placeholder = mediaPlaceholder(document, { name, reason, buttons });
    replaceKeepingFocus(placeholders.get(medium) ?? medium, placeholder);
    placeholders.set(medium, placeholder);
    media.set(placeholder, medium);
  }

  /** Keeps an image at its own size at most, once it has loaded. */
  function onLoad(event: Event) {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || image.naturalWidth === 0) {
      return;
    }
    const width = Number(image.getAttribute("width") ?? 0);
    const height = Number(image.getAttribute("height") ?? 0);
    if (width > image.naturalWidth || height > image.naturalHeight) {
      image.removeAttribute("width");
      image.removeAttribute("height");
    }
  }

  /**
   * Follows a click on Retry or Load image, which then goes no further,
   * e.g. to a link around it.
   */
  function onClick(event: MouseEvent) {
    const target = event.target instanceof Element ? event.target : null;
    const retry = target?.closest(`[${retryMediaAttribute}]`);
    const load = target?.closest(`[${loadImageAttribute}]`);
    if (retry instanceof HTMLButtonElement) {
      event.preventDefault();
      const placeholder = retry.closest<HTMLElement>(".media-placeholder");
      const medium = placeholder && media.get(placeholder);
      if (!medium) return;
      // Still focused, so that the keyboard moves on to what replaces it.
      retry.setAttribute("aria-disabled", "true");
      retry.textContent = "Retrying…";
      renewThenLoad(medium);
    } else if (load instanceof HTMLButtonElement) {
      event.preventDefault();
      void loadThirdParty(load);
    }
  }

  /**
   * Loads an image from elsewhere in place of its placeholder, which opens
   * in the viewer unless it is in a link, or says why it could not.
   */
  async function loadThirdParty(button: HTMLButtonElement) {
    const placeholder = button.closest<HTMLElement>(".media-placeholder");
    const url = button.getAttribute(loadImageAttribute) ?? "";
    const alt = button.getAttribute(imageAltAttribute) ?? "";
    button.setAttribute("aria-disabled", "true");
    button.textContent = "Loading…";
    const loaded = await options.loadImage(url);
    if (!followed || !placeholder) return;
    replaceKeepingFocus(
      placeholder,
      loaded.status === "loaded"
        ? mediaImage(document, {
            src: loaded.url,
            alt,
            inLink: placeholder.closest("a") !== null,
          })
        : thirdPartyPlaceholder(document, { url, alt, reason: loaded.reason }),
    );
  }

  // Neither event bubbles, so the body catches them on their way down.
  body.addEventListener("error", onError, true);
  body.addEventListener("load", onLoad, true);
  body.addEventListener("click", onClick);
  return () => {
    followed = false;
    body.removeEventListener("error", onError, true);
    body.removeEventListener("load", onLoad, true);
    body.removeEventListener("click", onClick);
  };
}

/**
 * Replaces an element, moving the keyboard to what replaces it if it was in
 * it: to the medium itself, or to a placeholder's first button.
 */
function replaceKeepingFocus(element: Element, next: HTMLElement) {
  const focused = element.contains(document.activeElement);
  element.replaceWith(next);
  if (!focused) return;
  const target = next.matches("img[tabindex], video")
    ? next
    : next.querySelector("button");
  target?.focus({ preventScroll: true });
}
