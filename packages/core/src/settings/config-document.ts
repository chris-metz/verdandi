import {
  parse,
  parseDocument,
  patch,
  stringify,
} from "@decimalturn/toml-patch";
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
  const defaults = defaultConfig(catalogue);
  const config = { ...defaults };
  let values: Record<string, unknown>;
  let lines: Map<string, number>;
  try {
    const document = parseDocument(text);
    values = document.toJsObject as Record<string, unknown>;
    lines = keyLines(document.cst);
  } catch (error) {
    const { line, sentence } = syntaxError(error);
    return {
      config,
      status: "unreadable",
      problems: [
        {
          ...(line === undefined ? {} : { line }),
          message: `${sentence} Verdandi uses every default until it is fixed.`,
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
    const checked = checkValue(key, value, catalogue);
    if (checked === undefined)
      problem(`Verdandi does not know the key ${key}, and ignores it.`);
    else if ("problem" in checked)
      problem(
        `${checked.problem} Verdandi uses "${defaults[checked.field]}" instead.`,
      );
    else Object.assign(config, checked.use);
  }
  // A key's place in the object is not always its place in the file.
  const last = Number.MAX_SAFE_INTEGER;
  problems.sort((a, b) => (a.line ?? last) - (b.line ?? last));
  return { config, status: "read", problems };
}

/** Each setting's key in the file. */
const fileKeys = {
  appearance: "appearance",
  lightTheme: "light_theme",
  darkTheme: "dark_theme",
} as const satisfies Record<keyof Config, string>;

/**
 * What Verdandi makes of a key in the file and its value: what it sets, or
 * which setting cannot use it and why. A key it does not know sets nothing.
 */
function checkValue(
  key: string,
  value: unknown,
  catalogue: ThemeCatalogue,
):
  | { use: Partial<Config> }
  | { field: keyof Config; problem: string }
  | undefined {
  const theme = (field: "lightTheme" | "darkTheme") => {
    const kind = field === "lightTheme" ? "light" : "dark";
    if (typeof value !== "string")
      return {
        field,
        problem: `${key} is ${shown(value)}, but must be the ID of a ${kind} theme, in quotes.`,
      };
    const found = catalogue.themes.find(({ id }) => id === value);
    if (found?.kind === kind) return { use: { [field]: value } };
    return {
      field,
      problem: `${key} is ${shown(value)}, which is ${found ? `a ${found.kind} theme` : "not a theme"}.`,
    };
  };
  switch (key) {
    case fileKeys.appearance:
      return appearances.includes(value)
        ? { use: { appearance: value as Appearance } }
        : {
            field: "appearance",
            problem: `appearance is ${shown(value)}, but can only be "system", "light" or "dark".`,
          };
    case fileKeys.lightTheme:
      return theme("lightTheme");
    case fileKeys.darkTheme:
      return theme("darkTheme");
    default:
      return undefined;
  }
}

/**
 * The text of `config.toml` with each value given set under its key, and
 * nothing else in it changed: comments, key order and formatting stay as
 * they are. Without a file, the text holds only these keys. Text that is
 * not valid TOML is not changed, nor is any text for a value that cannot be
 * used.
 */
export function changeConfigText(
  text: string | undefined,
  change: Partial<Config>,
  catalogue: ThemeCatalogue,
): { ok: true; text: string } | { ok: false; message: string } {
  const updates: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(change) as [string, unknown][]) {
    const key = (fileKeys as Record<string, string | undefined>)[field];
    const checked =
      key === undefined ? undefined : checkValue(key, value, catalogue);
    if (checked === undefined)
      return {
        ok: false,
        message: `Verdandi has no setting ${field}. Nothing was written.`,
      };
    if ("problem" in checked)
      return { ok: false, message: `${checked.problem} Nothing was written.` };
    updates[key as string] = value;
  }
  if (text === undefined) return { ok: true, text: stringify(updates) };
  let values: Record<string, unknown>;
  try {
    values = parse(text) as Record<string, unknown>;
  } catch (error) {
    return {
      ok: false,
      message: `${syntaxError(error).sentence} Nothing is written to it until it is fixed.`,
    };
  }
  return { ok: true, text: patch(text, { ...values, ...updates }) };
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
 * Where the parser stopped, if it says, and a sentence saying why, e.g.
 * "config.toml, line 2, is not valid TOML: Expected value, reached EOF."
 * Its message quotes the line with a caret, then gives the reason on the
 * last line.
 */
function syntaxError(error: unknown): {
  line: number | undefined;
  sentence: string;
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
  return {
    line,
    sentence: `${place(line)}${line === undefined ? "" : ","} is not valid TOML: ${reason}.`,
  };
}
