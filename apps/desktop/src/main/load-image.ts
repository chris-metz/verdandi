import type { LoadedImage } from "../shared/ipc";

/** The most an image may weigh: GitHub's own limit for uploaded images. */
const maxBytes = 10 * 1024 * 1024;

/** How many redirects are followed, each to another `https://` address. */
const maxRedirects = 5;

/** How long loading an image may take, in milliseconds. */
const timeout = 30 * 1000;

/**
 * Loads an image a body shows from elsewhere than GitHub's media hosts, once
 * the user asked (ADR 0003): only from `https://` addresses, redirects
 * included, without cookies, credentials or referrer, and outside the
 * window's session, so that nothing is cached on disk. Only images of at
 * most 10 MB are loaded.
 */
export async function loadImage(url: unknown): Promise<LoadedImage> {
  let address = typeof url === "string" ? URL.parse(url) : null;
  for (let redirects = 0; ; redirects++) {
    if (
      address?.protocol !== "https:" ||
      address.username !== "" ||
      address.password !== ""
    ) {
      return failed("Not an https:// address");
    }
    let response: Response;
    try {
      // Node's own fetch, which shares nothing with the window.
      response = await fetch(address, {
        redirect: "manual",
        headers: { accept: "image/*" },
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      return failed(`Cannot reach ${address.host}`);
    }
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      if (redirects === maxRedirects) return failed("Too many redirects");
      address = URL.parse(location, address.href);
      continue;
    }
    if (!response.ok) {
      return failed(`${address.host} answered HTTP ${String(response.status)}`);
    }
    const type =
      response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!type.toLowerCase().startsWith("image/")) return failed("Not an image");
    const bytes = await readAtMost(response, maxBytes);
    if (!bytes) return failed("Larger than 10 MB");
    return { status: "loaded", bytes, type };
  }
}

function failed(reason: string): LoadedImage {
  return { status: "failed", reason };
}

/** A response's body, unless it is larger than `limit` bytes. */
async function readAtMost(
  response: Response,
  limit: number,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    return undefined;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined =
    response.body?.getReader();
  for (;;) {
    const chunk = await reader?.read();
    if (!chunk || chunk.done) break;
    size += chunk.value.byteLength;
    if (size > limit) {
      await reader?.cancel();
      return undefined;
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
