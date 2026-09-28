import type {
  Setup,
  SidebarEntries,
  SidebarEntryKey,
  SidebarDestination,
} from "@verdandi/core/contract";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { accountLabel } from "./account-label";
import { entryShortcut, type ShortcutModifier } from "./pane-navigation";
import {
  presentScope,
  sameScope,
  scopeLabel,
  type ScopePresentation,
  type SidebarScope as Scope,
} from "./scope";
import { countLabel, type SidebarItem } from "./sidebar-entries";

/**
 * All, pinned on top, then the sidebar's sections, Repositories and Views,
 * then the account. Entries are selected by click or by the keys the window
 * handles; the sidebar pane itself holds the keyboard, not its entries.
 */
export function Sidebar({
  sidebar,
  setup,
  items,
  selected,
  onSelect,
  onReorder,
  settingsError,
  focused,
  shortcutsShown,
  modifier,
}: {
  sidebar: SidebarEntries | undefined;
  /** Whether Verdandi can read GitHub, and as which account. */
  setup: Setup | undefined;
  /** The sidebar's entries, in visual order. */
  items: readonly SidebarItem[];
  selected: Scope | undefined;
  onSelect: (scope: Scope) => void;
  onReorder: (
    entry: SidebarEntryKey,
    destination: SidebarDestination,
  ) => Promise<void>;
  settingsError: string | undefined;
  /** Whether the sidebar has the keyboard. */
  focused: boolean;
  /** Whether entries show their ⌘/Ctrl+1…9 shortcut instead of the count. */
  shortcutsShown: boolean;
  modifier: ShortcutModifier;
}) {
  const nav = useRef<HTMLElement>(null);
  const dragged = useRef<SidebarEntryKey | undefined>(undefined);
  const [drop, setDrop] = useState<{ key: string; side: "before" | "after" }>();
  const writable =
    sidebar?.status === "read" && sidebar.settings.status === "writable";

  // A selection moved by keyboard stays in sight.
  useLayoutEffect(() => {
    nav.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  /** An entry, with the shortcut of its place in visual order. */
  function renderEntry(item: SidebarItem) {
    const position = items.indexOf(item);
    const key = scopeLabel(item.scope);
    const entry: SidebarEntryKey | undefined =
      item.scope.kind === "all"
        ? undefined
        : item.scope.kind === "view"
          ? { kind: "view", id: item.scope.view.id }
          : item.scope;
    return (
      <Entry
        key={key}
        item={item}
        draggable={writable && entry !== undefined}
        dropSide={drop?.key === key ? drop.side : undefined}
        onDragStart={(event) => {
          dragged.current = entry;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", key);
          onSelect(item.scope);
        }}
        onDragOver={(event) => {
          if (!writable || !entry || dragged.current?.kind !== entry.kind)
            return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          const bounds = event.currentTarget.getBoundingClientRect();
          setDrop({
            key,
            side:
              event.clientY < bounds.top + bounds.height / 2
                ? "before"
                : "after",
          });
        }}
        onDrop={(event) => {
          event.preventDefault();
          const source = dragged.current;
          if (writable && source && entry && source.kind === entry.kind) {
            const bounds = event.currentTarget.getBoundingClientRect();
            void onReorder(source, {
              relativeTo: entry,
              side:
                event.clientY < bounds.top + bounds.height / 2
                  ? "before"
                  : "after",
            });
          }
          dragged.current = undefined;
          setDrop(undefined);
        }}
        onDragEnd={() => {
          dragged.current = undefined;
          setDrop(undefined);
        }}
        selected={selected !== undefined && sameScope(item.scope, selected)}
        focused={focused}
        shortcut={
          shortcutsShown ? entryShortcut(position, modifier) : undefined
        }
        onSelect={() => {
          onSelect(item.scope);
        }}
      />
    );
  }
  const inSection = (section: ScopePresentation["entry"]["section"]) =>
    items.filter((item) => presentScope(item.scope).entry.section === section);
  const repositories = inSection("repositories");

  return (
    <>
      <nav
        ref={nav}
        aria-label="Sidebar"
        className="min-h-0 flex-1 overflow-y-auto p-2"
      >
        <ul role="listbox" aria-label="All" className="flex flex-col gap-px">
          {inSection("pinned").map(renderEntry)}
        </ul>
        {sidebar?.status === "read" &&
          sidebar.settings.status !== "writable" && (
            <SettingsProblem status={sidebar.settings} />
          )}
        {settingsError && (
          <p role="alert" className="px-2 py-1 break-words text-destructive">
            {settingsError}
          </p>
        )}
        <SectionHeading>Repositories</SectionHeading>
        {sidebar === undefined ? null : sidebar.status === "failed" ? (
          <p
            role="alert"
            className="px-2 py-1 break-words whitespace-pre-line text-destructive"
          >
            {sidebar.message}
          </p>
        ) : repositories.length === 0 ? (
          <p className="px-2 py-1 text-muted-foreground">
            No tracked repositories
          </p>
        ) : (
          <ul
            role="listbox"
            aria-label="Repositories"
            className="flex flex-col gap-px"
          >
            {repositories.map(renderEntry)}
          </ul>
        )}
        <SectionHeading>Views</SectionHeading>
        <ul role="listbox" aria-label="Views" className="flex flex-col gap-px">
          {inSection("views").map(renderEntry)}
        </ul>
      </nav>
      <Account setup={setup} />
    </>
  );
}

function SectionHeading({ children }: { children: string }) {
  return (
    <h2 className="px-2 pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase first:pt-1">
      {children}
    </h2>
  );
}

/**
 * An entry: All with its icon, or a tracked repository's name with its owner
 * on a second line; then the open-issue count, or the entry's shortcut while
 * the modifier is held.
 */
function Entry({
  item: { scope, openIssues },
  selected,
  focused,
  shortcut,
  onSelect,
  draggable,
  dropSide,
  ...dragHandlers
}: {
  item: SidebarItem;
  selected: boolean;
  focused: boolean;
  shortcut: string | undefined;
  onSelect: () => void;
  draggable: boolean;
  dropSide: "before" | "after" | undefined;
  onDragStart: React.DragEventHandler<HTMLLIElement>;
  onDragOver: React.DragEventHandler<HTMLLIElement>;
  onDrop: React.DragEventHandler<HTMLLIElement>;
  onDragEnd: React.DragEventHandler<HTMLLIElement>;
}) {
  const { description, entry } = presentScope(scope);
  return (
    <li
      role="option"
      aria-selected={selected}
      title={description}
      onClick={onSelect}
      draggable={draggable}
      {...dragHandlers}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1 select-none",
        dropSide === "before" && "border-t-2 border-t-ring",
        dropSide === "after" && "border-b-2 border-b-ring",
        entry.section === "pinned" ? "min-h-8" : "min-h-10",
        selected
          ? focused
            ? "bg-selection shadow-[inset_2px_0_0_var(--selection-edge)]"
            : "bg-sidebar-accent text-sidebar-accent-foreground"
          : "hover:bg-sidebar-accent",
      )}
    >
      {entry.section === "pinned" ? (
        <>
          <svg
            viewBox="0 0 16 16"
            aria-hidden
            className="size-4 shrink-0 fill-none stroke-current stroke-[1.4] text-muted-foreground"
          >
            <path d="M8 1.8 14.2 5 8 8.2 1.8 5z" />
            <path d="M1.8 8 8 11.2 14.2 8M1.8 11 8 14.2 14.2 11" />
          </svg>
          <span
            className={cn("min-w-0 flex-1 truncate", selected && "font-medium")}
          >
            {entry.name}
          </span>
        </>
      ) : (
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className={cn("truncate", selected && "font-medium")}>
            {entry.name}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {entry.section === "repositories" ? entry.owner : entry.query}
          </span>
        </span>
      )}
      {shortcut ? (
        <kbd className="shrink-0 rounded border border-b-2 bg-background px-1 font-mono text-[11px] text-muted-foreground">
          {shortcut}
        </kbd>
      ) : (
        <span
          title={
            openIssues.status === "failed" ? openIssues.message : undefined
          }
          className="shrink-0 text-xs text-muted-foreground tabular-nums"
        >
          {countLabel(openIssues)}
        </span>
      )}
    </li>
  );
}

function SettingsProblem({
  status,
}: {
  status: Exclude<
    import("@verdandi/core/contract").SettingsStatus,
    { status: "writable" }
  >;
}) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function act(action: "reload" | "reset" | "folder") {
    setBusy(true);
    setError(undefined);
    try {
      if (action === "folder") await window.desktop.showSettingsFolder();
      else if (action === "reload") await window.verdandi.reloadSettings();
      else {
        const result = await window.verdandi.resetSettings();
        if (!result.ok) setError(result.message);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="my-2 rounded-md border border-destructive/40 p-2 text-xs">
      <p role="alert" className="break-words whitespace-pre-line">
        {status.message}
      </p>
      {status.status === "invalid" && (
        <p className="mt-2 text-muted-foreground">
          Reset keeps a backup and starts empty.
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {(
          [
            ["folder", "Show folder"],
            ["reload", "Reload"],
            ...(status.status === "invalid" ? [["reset", "Reset"]] : []),
          ] as const
        ).map(([action, label]) => (
          <button
            key={action}
            disabled={busy}
            className="rounded border px-2 py-1 hover:bg-sidebar-accent disabled:opacity-50"
            onClick={() => {
              void act(action as "folder" | "reload" | "reset");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 break-words text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Which account Verdandi reads GitHub as, and where its token comes from when
 * an environment variable overrides gh's stored account, or why the account
 * is not confirmed. While the setup blocker covers the app, it says nothing.
 */
function Account({ setup }: { setup: Setup | undefined }) {
  if (setup?.status === "blocked") return null;
  const label =
    setup?.status === "ready" ? accountLabel(setup.account) : undefined;
  return (
    <footer className="border-t border-sidebar-border px-4 py-2 text-xs">
      {label === undefined ? (
        <p className="text-muted-foreground">Checking GitHub access…</p>
      ) : (
        <p
          title={label.detail}
          className={cn(
            "truncate text-muted-foreground",
            label.detail !== undefined && "cursor-help",
          )}
        >
          {label.text}
        </p>
      )}
    </footer>
  );
}

/**
 * What the sidebar lists, as the core last read or pushed it. Counts arrive
 * as pushes after the first read.
 */
export function useSidebar(): SidebarEntries | undefined {
  const [sidebar, setSidebar] = useState<SidebarEntries>();
  useEffect(() => {
    let current = true;
    // A push is newer than the answer to a read that started before it.
    let pushed = false;
    const unsubscribe = window.verdandi.on("sidebarChanged", (changed) => {
      pushed = true;
      setSidebar(changed);
    });
    window.verdandi.getSidebar().then(
      (read) => {
        if (current && !pushed) setSidebar(read);
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (current) setSidebar({ status: "failed", message });
      },
    );
    return () => {
      current = false;
      unsubscribe();
    };
  }, []);
  return sidebar;
}
