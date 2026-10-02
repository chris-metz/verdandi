import {
  parse,
  parseDocument,
  patch,
  stringify,
} from "@decimalturn/toml-patch";
import {
  textSizes,
  type Appearance,
  type Config,
  type ConfigProblem,
  type ConfigState,
} from "../contract.ts";
import type { FontDefaults, ThemeCatalogue } from "./port.ts";

const appearances: readonly unknown[] = [
  "system",
  "light",
  "dark",
] satisfies Appearance[];

/**
 * What `config.toml` is checked against: the interface's themes, the fonts
 * it uses by default, and the font families installed, once it has said.
 */
export interface ConfigCatalogue {
  themes: ThemeCatalogue;
  fonts: FontDefaults;
  installedFonts: readonly string[] | undefined;
}

/** What applies without a file, and in place of a value that cannot be used. */
export function defaultConfig(themes: ThemeCatalogue): Config {
  return {
    appearance: "system",
    lightTheme: themes.defaults.light,
    darkTheme: themes.defaults.dark,
    interfaceFont: null,
    codeFont: null,
    textSize: textSizes.default,
  };
}

/**
 * Reads the text of `config.toml`. Each value that cannot be used is
 * replaced by its default, and an unknown key is ignored, each with a
 * problem; text that is not valid TOML means every default.
 */
export function readConfig(
  text: string,
  catalogue: ConfigCatalogue,
): Pick<ConfigState, "config" | "status" | "problems"> {
  const defaults = defaultConfig(catalogue.themes);
  const config = { ...defaults };
  // A default font is null in the configuration, but the user is told its
  // name.
  const fallbacks = { ...defaults, ...catalogue.fonts };
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
    const problem = (message: string, missingFont?: string) => {
      problems.push({
        key,
        ...(line === undefined ? {} : { line }),
        message: `${place(line)}: ${message}`,
        ...(missingFont === undefined ? {} : { missingFont }),
      });
    };
    const checked = checkValue(key, value, catalogue);
    if (checked === undefined)
      problem(`Verdandi does not know the key ${key}, and ignores it.`);
    else if ("problem" in checked)
      problem(
        [
          checked.problem,
          `Verdandi uses ${shown(fallbacks[checked.field])} instead.`,
          // The interface lists the installed families as it starts.
          ...(checked.missingFont === undefined
            ? []
            : [
                "If you installed it since Verdandi started, restart Verdandi.",
              ]),
        ].join(" "),
        checked.missingFont,
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
  interfaceFont: "font",
  codeFont: "code_font",
  textSize: "text_size",
} as const satisfies Record<keyof Config, string>;

/**
 * Whether a value is its setting's default, which the file leaves out: no
 * font, or the default text size.
 */
function leftOut(field: string, value: unknown): boolean {
  switch (field) {
    case "interfaceFont":
    case "codeFont":
      return value === null;
    case "textSize":
      return value === textSizes.default;
    default:
      return false;
  }
}

/**
 * What Verdandi makes of a key in the file and its value: what it sets, or
 * which setting cannot use it and why, with the font family when it is not
 * installed. A key it does not know sets nothing.
 */
function checkValue(
  key: string,
  value: unknown,
  catalogue: ConfigCatalogue,
):
  | { use: Partial<Config> }
  | { field: keyof Config; problem: string; missingFont?: string }
  | undefined {
  const theme = (field: "lightTheme" | "darkTheme") => {
    const kind = field === "lightTheme" ? "light" : "dark";
    if (typeof value !== "string")
      return {
        field,
        problem: `${key} is ${shown(value)}, but must be the ID of a ${kind} theme, in quotes.`,
      };
    const found = catalogue.themes.themes.find(({ id }) => id === value);
    if (found?.kind === kind) return { use: { [field]: value } };
    return {
      field,
      problem: `${key} is ${shown(value)}, which is ${found ? `a ${found.kind} theme` : "not a theme"}.`,
    };
  };
  const family = (field: "interfaceFont" | "codeFont") => {
    if (typeof value !== "string" || value.trim() === "")
      return {
        field,
        problem: `${key} is ${shown(value)}, but must be the name of a font family, in quotes.`,
      };
    const { installedFonts } = catalogue;
    if (installedFonts === undefined) return { use: { [field]: value } };
    const name = value.toLowerCase();
    const found = installedFonts.find(
      (family) => family.toLowerCase() === name,
    );
    if (found !== undefined) return { use: { [field]: found } };
    return {
      field,
      problem: `${key} is ${shown(value)}, which is not installed.`,
      missingFont: value,
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
    case fileKeys.interfaceFont:
      return family("interfaceFont");
    case fileKeys.codeFont:
      return family("codeFont");
    case fileKeys.textSize: {
      const { smallest, largest } = textSizes;
      if (typeof value === "number" && value >= smallest && value <= largest)
        return { use: { textSize: value } };
      const quotes = typeof value === "string" ? ", without quotes" : "";
      return {
        field: "textSize",
        problem: `${key} is ${shown(value)}, but must be a number from ${String(smallest)} to ${String(largest)}${quotes}.`,
      };
    }
    default:
      return undefined;
  }
}

/**
 * The text of `config.toml` with each value given set under its key, or its
 * key removed for its default where the file leaves that out (see
 * `leftOut`), and nothing else in it changed:
 * comments, key order and formatting stay as they are. Without a file, the
 * text holds only the keys set, and there is none without any. Text that is
 * not valid TOML is not changed, nor is any text for a value that cannot be
 * used.
 */
export function changeConfigText(
  text: string | undefined,
  change: Partial<Config>,
  catalogue: ConfigCatalogue,
): { ok: true; text: string | undefined } | { ok: false; message: string } {
  const updates: Record<string, unknown> = {};
  const removed = new Set<string>();
  for (const [field, value] of Object.entries(change) as [string, unknown][]) {
    const key = (fileKeys as Record<string, string | undefined>)[field];
    if (key !== undefined && leftOut(field, value)) {
      removed.add(key);
      continue;
    }
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
  if (text === undefined)
    return {
      ok: true,
      text: Object.keys(updates).length === 0 ? undefined : stringify(updates),
    };
  let values: Record<string, unknown>;
  try {
    values = parse(text) as Record<string, unknown>;
  } catch (error) {
    return {
      ok: false,
      message: `${syntaxError(error).sentence} Nothing is written to it until it is fixed.`,
    };
  }
  const kept = Object.fromEntries(
    Object.entries(values).filter(([key]) => !removed.has(key)),
  );
  return {
    ok: true,
    text: patch(withoutKeyLines(text, removed), { ...kept, ...updates }),
  };
}

/**
 * The text without the lines of each top-level key-value with one of these
 * keys, but with the comments above it, which patching would remove with
 * it, e.g. one heading several keys. A key given another way, e.g. as a
 * table, is left for patching to remove.
 */
function withoutKeyLines(text: string, keys: ReadonlySet<string>): string {
  if (keys.size === 0) return text;
  const blocks: unknown = parseDocument(text).cst;
  if (!Array.isArray(blocks)) return text;
  const removed = new Set<number>();
  for (const block of blocks as SyntaxBlock[]) {
    // A dotted key, e.g. font.name, is a table's.
    const [key, ...dotted] = block.key?.value ?? [];
    if (
      block.type !== "KeyValue" ||
      key === undefined ||
      dotted.length > 0 ||
      !keys.has(key) ||
      !block.loc
    )
      continue;
    for (let line = block.loc.start.line; line <= block.loc.end.line; line++)
      removed.add(line);
  }
  return text
    .split("\n")
    .filter((_, index) => !removed.has(index + 1))
    .join("\n");
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
  type?: string;
  key?: { value?: string[]; item?: { value?: string[] } };
  loc?: { start: { line: number }; end: { line: number } };
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
