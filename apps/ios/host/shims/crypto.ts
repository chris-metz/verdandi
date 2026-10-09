/** `node:crypto` for the iOS host: random UUIDs and SHA-256 in hex. */
import { native } from "../native.ts";

export function randomUUID(): string {
  return native().randomUUID();
}

/** A hash as the core uses one: SHA-256 of strings, digested to hex. */
export interface Hash {
  update(text: string): Hash;
  digest(encoding: string): string;
}

export function createHash(algorithm: string): Hash {
  if (algorithm !== "sha256")
    throw new Error(`Only SHA-256 is available, not ${algorithm}.`);
  let text = "";
  const hash: Hash = {
    update(more) {
      text += more;
      return hash;
    },
    digest(encoding) {
      if (encoding !== "hex")
        throw new Error(`Only hex digests are available, not ${encoding}.`);
      return native().sha256(text);
    },
  };
  return hash;
}

export default { randomUUID, createHash };
