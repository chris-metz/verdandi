import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

/**
 * Renames a file over another, trying again for a moment while Windows
 * virus scanners and sync clients briefly hold it open.
 */
export async function renameOver(
  from: string,
  to: string,
  renameFile: typeof rename = rename,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      await renameFile(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 4 || (code !== "EPERM" && code !== "EBUSY")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt));
    }
  }
}

/**
 * Writes a file whole under a temporary name beside it, then renames that
 * over the file, so that no reader ever sees it half written. The temporary
 * file is gone afterwards, whether or not it worked.
 */
export async function writeWhole(
  file: string,
  text: string,
  {
    mode,
    rename: renameFile = rename,
  }: { mode?: number; rename?: typeof rename } = {},
) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { flag: "wx", mode });
    await renameOver(temporary, file, renameFile);
  } finally {
    await rm(temporary, { force: true });
  }
}
