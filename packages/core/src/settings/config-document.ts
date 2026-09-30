import { parseDocument } from "@decimalturn/toml-patch";
import type {
  Appearance,
  Config,
  ConfigProblem,
  ConfigState,
} from "../contract.ts";
import type { ThemeCatalogue } from "./port.ts";

const appearances: readonly unknown[] = [
  "system",
  "light",
  "dark",
] satisfies Appearance[];

/** What applies without a file, and in place of a value that cannot be used. */
export function defaultConfig(catalogue: ThemeCatalogue): Config {
  return {
    appearance: "system",
    lightTheme: catalogue.defaults.light,
    darkTheme: catalogue.defaults.dark,
  };
}

/**
 * Reads the text of `config.toml`. Each value that cannot be used is
 * replaced by its default, and an unknown key is ignored, each with a
 * problem; text that is not valid TOML means every default.
 */
export function readConfig(
  text: string,
  catalogue: ThemeCatalogue,
): Pick<ConfigState, "config" | "status" | "problems"> {
  const config = defaultConfig(catalogue);
  let values: Record<string, unknown>;
  let lines: Map<string, number>;
  try {
    const document = parseDocument(text);
    values = document.toJsObject as Record<string, unknown>;
    lines = keyLines(document.cst);
  } catch (error) {
    const { line, reason } = syntaxError(error);
    return {
      config,
      status: "unreadable",
      problems: [
        {
          ...(line === undefined ? {} : { line }),
          message: `${place(line)}${line === undefined ? "" : ","} is not valid TOML: ${reason}. Verdandi uses every default until it is fixed.`,
        },
      ],
    };
  }
  const problems: ConfigProblem[] = [];
  for (const [key, value] of Object.entries(values)) {
    const line = lines.get(key);
    const problem = (message: string) => {
      problems.push({
        key,
        ...(line === undefined ? {} : { line }),
        message: `${place(line)}: ${message}`,
      });
    };
    const theme = (kind: "light" | "dark") => {
      const instead = `Verdandi uses "${catalogue.defaults[kind]}" instead.`;
      if (typeof value !== "string") {
        problem(
          `${key} is ${shown(value)}, but must be the ID of a ${kind} theme, in quotes. ${instead}`,
        );
        return undefined;
      }
      const found = catalogue.themes.find(({ id }) => id === value);
      if (found?.kind === kind) return value;
      problem(
        `${key} is ${shown(value)}, which is ${found ? `a ${found.kind} theme` : "not a theme"}. ${instead}`,
      );
      return undefined;
    };
    switch (key) {
      case "appearance":
        if (appearances.includes(value))
          config.appearance = value as Appearance;
        else
          problem(
            `appearance is ${shown(value)}, but can only be "system", "light" or "dark". Verdandi uses "${config.appearance}" instead.`,
          );
        break;
      case "light_theme":
        config.lightTheme = theme("light") ?? config.lightTheme;
        break;
      case "dark_theme":
        config.darkTheme = theme("dark") ?? config.darkTheme;
        break;
      default:
        problem(`Verdandi does not know the key ${key}, and ignores it.`);
    }
  }
  // A key's place in the object is not always its place in the file.
  const last = Number.MAX_SAFE_INTEGER;
  problems.sort((a, b) => (a.line ?? last) - (b.line ?? last));
  return { config, status: "read", problems };
}

/** "config.toml, line 3", or only the file when the line is not known. */
function place(line: number | undefined): string {
  return line === undefined
    ? "config.toml"
    : `config.toml, line ${String(line)}`;
}

/** A value as the user wrote it, or what kind of value it is. */
function shown(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "a list";
  if (value instanceof Date) return "a date";
  if (typeof value === "object" && value !== null) return "a table";
  return String(value);
}

/**
 * The line each top-level key is on, as the parser's syntax tree has it:
 * a key's own line, or its table's header. Without a syntax tree it knows,
 * no line is known.
 */
function keyLines(blocks: unknown): Map<string, number> {
  const lines = new Map<string, number>();
  if (!Array.isArray(blocks)) return lines;
  for (const block of blocks as SyntaxBlock[]) {
    const [key] = block.key?.item?.value ?? block.key?.value ?? [];
    const line = block.loc?.start.line;
    if (typeof key === "string" && typeof line === "number" && !lines.has(key))
      lines.set(key, line);
  }
  return lines;
}

/** A top-level key-value, table or array of tables in the syntax tree. */
interface SyntaxBlock {
  key?: { value?: string[]; item?: { value?: string[] } };
  loc?: { start: { line: number } };
}

/**
 * Where the parser stopped, and why. Its message quotes the line with a
 * caret, then gives the reason on the last line.
 */
function syntaxError(error: unknown): {
  line: number | undefined;
  reason: string;
} {
  const text = error instanceof Error ? error.message : String(error);
  const line =
    typeof error === "object" &&
    error !== null &&
    "line" in error &&
    typeof error.line === "number"
      ? error.line
      : undefined;
  const reason = (text.trim().split("\n").at(-1) ?? text).replace(/\.$/, "");
  return { line, reason };
}
