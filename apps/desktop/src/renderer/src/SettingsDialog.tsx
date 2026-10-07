import { Slider } from "@base-ui/react/slider";
import {
  textSizes,
  type Appearance,
  type Config,
  type ConfigState,
} from "@verdandi/core/contract";
import { Check } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { builtInThemes, type Theme } from "../../shared/themes";
import { FontPicker } from "./FontPicker";
import type { FontUse } from "./fonts";
import { useFonts } from "./installed-fonts";

/** The dialog's sections, in its sidebar's order, each with its settings. */
const sections = [
  { label: "Appearance", Settings: AppearanceSection },
] as const;

/**
 * The settings dialog: a sidebar of sections, and the chosen section's
 * settings beside it. Each choice is written to `config.toml` at once, and
 * the dialog follows the file as it changes, by hand too. Esc closes it.
 */
export function SettingsDialog({
  config,
  onClose,
}: {
  /** `config.toml` as the core last read or pushed it. */
  config: ConfigState;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<(typeof sections)[number]>(
    sections[0],
  );
  const content = useRef<HTMLDivElement>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        // The first setting's choice, rather than the sidebar.
        initialFocus={() =>
          content.current?.querySelector<HTMLElement>(
            '[role="radio"][tabindex="0"]:not(:disabled)',
          ) ?? true
        }
        className="flex max-h-[calc(100%-3rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <DialogTitle>Settings</DialogTitle>
          <kbd className="rounded border border-b-2 px-1 font-mono text-2xs text-muted-foreground">
            Esc
          </kbd>
        </div>
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Settings sections"
            className="flex w-40 shrink-0 flex-col gap-0.5 border-r bg-sidebar p-2 text-sidebar-foreground"
          >
            {sections.map((section) => (
              <button
                key={section.label}
                type="button"
                aria-current={section === selected ? "page" : undefined}
                onClick={() => {
                  setSelected(section);
                }}
                className={cn(
                  "rounded-md px-2 py-1 text-left hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-sidebar-ring",
                  section === selected &&
                    "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                )}
              >
                {section.label}
              </button>
            ))}
          </nav>
          <div ref={content} className="min-w-0 flex-1 overflow-y-auto p-4">
            <selected.Settings config={config} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The fonts, in the dialog's order, each with its key in `config.toml`. */
const fontSettings: readonly { use: FontUse; label: string; key: string }[] = [
  { use: "interfaceFont", label: "Interface font", key: "font" },
  { use: "codeFont", label: "Code font", key: "code_font" },
];

/** The appearances, in the segmented control's order. */
const appearances: readonly { value: Appearance; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * The appearance, the light and dark theme, the interface and code font,
 * and the text size, each chosen at once. While the file cannot be read as
 * TOML, they cannot be changed.
 */
function AppearanceSection({ config }: { config: ConfigState }) {
  // Why the last choice was not written, until the file changes.
  const [error, setError] = useState<{ message: string; for: ConfigState }>();
  const disabled = config.status === "unreadable";
  const fonts = useFonts();

  async function choose(change: Partial<Config>) {
    setError(undefined);
    let message: string;
    try {
      const result = await window.verdandi.changeConfig(change);
      if (result.ok) return;
      message = result.message;
    } catch (cause) {
      message = cause instanceof Error ? cause.message : String(cause);
    }
    setError({ message, for: config });
  }

  return (
    <div className="flex flex-col gap-5">
      <FileProblems config={config} />
      {error?.for === config && (
        <p role="alert" className="text-xs break-words text-destructive">
          {error.message}
        </p>
      )}
      <Setting label="Appearance">
        {(labelId) => (
          <RadioGroup
            labelId={labelId}
            className="flex w-fit rounded-md border p-0.5"
          >
            {appearances.map(({ value, label }) => {
              const checked = value === config.config.appearance;
              return (
                <Radio
                  key={value}
                  checked={checked}
                  disabled={disabled}
                  onChoose={() => {
                    void choose({ appearance: value });
                  }}
                  className={cn(
                    "rounded px-3 py-1 text-muted-foreground not-disabled:hover:text-foreground disabled:opacity-50",
                    checked && "bg-muted font-medium text-foreground",
                  )}
                >
                  {label}
                </Radio>
              );
            })}
          </RadioGroup>
        )}
      </Setting>
      <ThemeSetting
        label="Light theme"
        themes={builtInThemes.filter(({ kind }) => kind === "light")}
        chosen={config.config.lightTheme}
        disabled={disabled}
        onChoose={(id) => {
          void choose({ lightTheme: id });
        }}
      />
      <ThemeSetting
        label="Dark theme"
        themes={builtInThemes.filter(({ kind }) => kind === "dark")}
        chosen={config.config.darkTheme}
        disabled={disabled}
        onChoose={(id) => {
          void choose({ darkTheme: id });
        }}
      />
      <div className="grid grid-cols-2 gap-4">
        {fontSettings.map(({ use, label, key }) => (
          <Setting key={use} label={label}>
            {(labelId) => (
              <FontPicker
                labelId={labelId}
                use={use}
                chosen={config.config[use]}
                missing={
                  config.problems.find((problem) => problem.key === key)
                    ?.missingFont
                }
                fonts={fonts}
                disabled={disabled}
                onChoose={(family) => {
                  void choose({ [use]: family });
                }}
              />
            )}
          </Setting>
        ))}
      </div>
      <TextSizeSetting
        chosen={config.config.textSize}
        disabled={disabled}
        onChoose={(size) => choose({ textSize: size })}
      />
      <ConfigFileLink config={config} />
    </div>
  );
}

/** A setting's name above its control, which it labels. */
function Setting({
  label,
  children,
}: {
  label: string;
  children: (labelId: string) => React.ReactNode;
}) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-xs font-medium">
        {label}
      </span>
      {children(labelId)}
    </div>
  );
}

/** A grid of tiles, one per theme of a kind, the chosen one marked. */
function ThemeSetting({
  label,
  themes,
  chosen,
  disabled,
  onChoose,
}: {
  label: string;
  themes: readonly Theme[];
  chosen: string;
  disabled: boolean;
  onChoose: (id: string) => void;
}) {
  return (
    <Setting label={label}>
      {(labelId) => (
        <RadioGroup labelId={labelId} className="grid grid-cols-3 gap-3">
          {themes.map((theme) => {
            const checked = theme.id === chosen;
            return (
              <Radio
                key={theme.id}
                checked={checked}
                disabled={disabled}
                onChoose={() => {
                  onChoose(theme.id);
                }}
                className="group flex flex-col gap-1.5 rounded-lg p-1 text-left disabled:opacity-50"
              >
                <ThemeMiniature theme={theme} checked={checked} />
                <span
                  className={cn(
                    "flex items-center gap-1 px-0.5 text-xs",
                    checked
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {checked && (
                    <Check
                      aria-hidden
                      className="size-3.5 text-selection-edge"
                    />
                  )}
                  {theme.name}
                </span>
              </Radio>
            );
          })}
        </RadioGroup>
      )}
    </Setting>
  );
}

/**
 * The app in a theme's colours, in miniature: a sidebar strip beside the
 * background, with two lines of text and an open, a closed and a blocked
 * dot.
 */
function ThemeMiniature({
  theme,
  checked,
}: {
  theme: Theme;
  checked: boolean;
}) {
  const { colors } = theme;
  return (
    <div
      aria-hidden
      className={cn(
        "flex h-20 overflow-hidden rounded-md border",
        checked &&
          "ring-2 ring-selection-edge ring-offset-2 ring-offset-popover",
      )}
      style={{ background: colors.background, borderColor: colors.border }}
    >
      <div
        className="w-1/4 border-r"
        style={{
          background: colors.sidebar,
          borderColor: colors["sidebar-border"],
        }}
      />
      <div className="flex flex-1 flex-col justify-center gap-1.5 px-3">
        <div
          className="h-1.5 w-4/5 rounded-full"
          style={{ background: colors.foreground }}
        />
        <div
          className="h-1.5 w-1/2 rounded-full"
          style={{ background: colors["muted-foreground"] }}
        />
        <div className="mt-1 flex gap-1.5">
          {(["issue-open", "issue-closed", "blocked"] as const).map((token) => (
            <span
              key={token}
              className="size-2 rounded-full"
              style={{ background: colors[token] }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A slider of the text sizes, from the smallest to the largest, with the
 * default marked. A size is chosen as the thumb is let go, or with each key
 * that moves it.
 */
function TextSizeSetting({
  chosen,
  disabled,
  onChoose,
}: {
  chosen: number;
  disabled: boolean;
  /** Settles once the choice is written, or could not be. */
  onChoose: (size: number) => Promise<void>;
}) {
  // The size under the thumb, from when it moves until it is written.
  const [moving, setMoving] = useState<number>();
  const { smallest, largest, default: standard } = textSizes;
  const shown = moving ?? chosen;
  const at = (size: number) =>
    `${String(((size - smallest) / (largest - smallest)) * 100)}%`;
  return (
    <Setting label="Text size">
      {(labelId) => (
        <div className="flex items-start gap-4">
          <Slider.Root
            aria-labelledby={labelId}
            value={shown}
            min={smallest}
            max={largest}
            disabled={disabled}
            onValueChange={(size) => {
              setMoving(size);
            }}
            onValueCommitted={(size) => {
              setMoving(size);
              void onChoose(size).finally(() => {
                // Unless it has moved on since.
                setMoving((current) =>
                  current === size ? undefined : current,
                );
              });
            }}
            className="w-72 data-disabled:opacity-50"
          >
            <Slider.Control className="flex h-line-5 items-center">
              <Slider.Track className="h-1 w-full rounded-full bg-muted">
                <Slider.Indicator className="rounded-full bg-selection-edge" />
                <Slider.Thumb
                  getAriaValueText={(_, size) =>
                    `${String(size)} pixels${size === standard ? ", the default" : ""}`
                  }
                  className="size-4 rounded-full border-2 border-selection-edge bg-background shadow-sm has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
                />
              </Slider.Track>
            </Slider.Control>
            <div
              aria-hidden
              className="relative h-line-7 text-2xs text-muted-foreground"
            >
              {Array.from(
                { length: largest - smallest + 1 },
                (_, index) => smallest + index,
              ).map((size) => (
                <span
                  key={size}
                  style={{ left: at(size) }}
                  className={cn(
                    "absolute top-0 w-px -translate-x-1/2",
                    size === standard
                      ? "h-2 bg-muted-foreground"
                      : "h-1 bg-border",
                  )}
                />
              ))}
              {[
                { size: smallest, label: String(smallest) },
                { size: standard, label: "Default" },
                { size: largest, label: String(largest) },
              ].map(({ size, label }) => (
                <span
                  key={size}
                  style={{ left: at(size) }}
                  className="absolute top-2.5 -translate-x-1/2"
                >
                  {label}
                </span>
              ))}
            </div>
          </Slider.Root>
          <span className="flex h-line-5 items-center tabular-nums">
            {shown} px
          </span>
        </div>
      )}
    </Setting>
  );
}

/**
 * Radios that work as one group: Tab enters it at the chosen one, and the
 * arrow keys move to the next or previous one, wrapping around, and choose
 * it.
 */
function RadioGroup({
  labelId,
  className,
  children,
}: {
  labelId: string;
  className: string;
  children: React.ReactNode;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    const step = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    }[event.key];
    if (step === undefined) return;
    const radios = [
      ...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'),
    ];
    const index = radios.findIndex((radio) => radio === event.target);
    if (index < 0) return;
    event.preventDefault();
    const next = radios[(index + step + radios.length) % radios.length];
    next?.focus();
    next?.click();
  }
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      onKeyDown={onKeyDown}
      className={className}
    >
      {children}
    </div>
  );
}

/** One radio of a `RadioGroup`, which Tab reaches only when it is chosen. */
function Radio({
  checked,
  disabled,
  onChoose,
  className,
  children,
}: {
  checked: boolean;
  disabled: boolean;
  onChoose: () => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={checked ? 0 : -1}
      disabled={disabled}
      onClick={onChoose}
      className={cn(
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Why the settings cannot be changed while the file cannot be read, or what
 * in it Verdandi cannot use, which choosing here replaces.
 */
function FileProblems({ config }: { config: ConfigState }) {
  if (config.problems.length === 0) return null;
  const unreadable = config.status === "unreadable";
  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border p-2.5 text-xs",
        unreadable ? "border-destructive/40" : "border-warning/50",
      )}
    >
      {unreadable && (
        <p className="mb-1 font-medium">
          These settings cannot be changed until config.toml is fixed.
        </p>
      )}
      <ul className="flex flex-col gap-1 break-words">
        {config.problems.map((problem, index) => (
          <li key={index}>{problem.message}</li>
        ))}
      </ul>
    </div>
  );
}

/** "Open config.toml", which opens it in the default editor once it exists. */
function ConfigFileLink({ config }: { config: ConfigState }) {
  const [error, setError] = useState<string>();
  const missing = config.status === "missing";
  return (
    <div className="flex flex-col gap-1 border-t pt-3 text-xs">
      <div className="flex items-baseline gap-2">
        <button
          type="button"
          disabled={missing}
          onClick={() => {
            setError(undefined);
            window.desktop.openConfigFile().catch((cause: unknown) => {
              setError(cause instanceof Error ? cause.message : String(cause));
            });
          }}
          className="shrink-0 rounded font-medium underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring disabled:text-muted-foreground disabled:no-underline"
        >
          Open config.toml
        </button>
        <span className="truncate text-muted-foreground" title={config.file}>
          {missing ? "Your first change here creates it." : config.file}
        </span>
      </div>
      {error && (
        <p role="alert" className="break-words text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
