import type { ThirdPartyImage } from "./media-loading";

/**
 * Images from elsewhere than GitHub's media hosts, each loaded by main once
 * the user asked, by their address: the window's Content Security Policy
 * lets them show only as blobs. One loaded stays so for the session, so
 * that asking for it again reads nothing again.
 */
const loading = new Map<string, Promise<ThirdPartyImage>>();

/** Loads an image from elsewhere, once asked, into a blob that shows it. */
export function loadThirdPartyImage(url: string): Promise<ThirdPartyImage> {
  let load = loading.get(url);
  if (!load) {
    load = window.desktop.loadImage(url).then(
      (image): ThirdPartyImage => {
        if (image.status === "failed") {
          loading.delete(url);
          return image;
        }
        const blob = new Blob([image.bytes], { type: image.type });
        return { status: "loaded", url: URL.createObjectURL(blob) };
      },
      (): ThirdPartyImage => {
        loading.delete(url);
        return { status: "failed", reason: "Could not be loaded" };
      },
    );
    loading.set(url, load);
  }
  return load;
}
