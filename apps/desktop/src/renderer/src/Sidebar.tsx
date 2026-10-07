import type {
  SavedView,
  Setup,
  SidebarEntries,
  SidebarEntryKey,
  SidebarDestination,
  TrackedRepository,
} from "@verdandi/core/contract";
import { ListFilter, TriangleAlert } from "lucide-react";
import { problemText } from "./problem-text";
import { ContextMenu } from "@base-ui/react/context-menu";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { cn } from "@/lib/utils";
import { accountLabel } from "./account-label";
import { AllIcon } from "./AllIcon";
import { ConfigProblems } from "./ConfigProblems";
import { opensInNewTab } from "./open-in-new-tab";
import { entryShortcut, type ShortcutModifier } from "./pane-navigation";
import { RateLimitsButton } from "./RateLimitsButton";
import {
  presentScope,
  repositoryLabel,
  sameScope,
  scopeLabel,
  type ScopePresentation,
  type SidebarScope as Scope,
} from "./scope";
import {
  countLabel,
  matchCountLabel,
  type SidebarItem,
} from "./sidebar-entries";

/**
 * All, pinned on top, then the sidebar's sections, Repositories and Views,
 * then the account. Entries are selected by click or by the keys the window
 * handles, into the tab shown; the sidebar pane itself holds the keyboard,
 * not its entries. A click with ⌘ held (Ctrl elsewhere), or Open in New Tab
 * in its context menu, opens an entry in a new tab instead, in the
 * background.
 */
export function Sidebar({
  sidebar,
  setup,
  items,
  selected,
  onSelect,
  onSelectInNewTab,
  onReorder,
  onAddRepository,
  onRemoveRepository,
  onTrackNewRepository,
  onNewView,
  onEditView,
  onDuplicateView,
  onRemoveView,
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
  /** The entry of the tab shown; none for a new tab. */
  selected: Scope | undefined;
  onSelect: (scope: Scope) => void;
  onSelectInNewTab: (scope: Scope) => void;
  onReorder: (
    entry: SidebarEntryKey,
    destination: SidebarDestination,
  ) => Promise<void>;
  /** Opens the repository picker. */
  onAddRepository: () => void;
  onRemoveRepository: (repository: TrackedRepository) => void;
  /**
   * Tracks the repository that took over a tracked repository's name in its
   * place.
   */
  onTrackNewRepository: (repository: TrackedRepository) => void;
  /** Opens the view dialog for a new view. */
  onNewView: () => void;
  /** Opens the view dialog for a view. */
  onEditView: (view: SavedView) => void;
  /** Opens the view dialog for a new view that duplicates a view. */
  onDuplicateView: (view: SavedView) => void;
  /** Asks to remove a view. */
  onRemoveView: (view: SavedView) => void;
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
        login={
          setup?.status === "ready" && setup.account.status === "known"
            ? setup.account.account.login
            : undefined
        }
        menu={menuOf(item)}
        onEdit={
          item.scope.kind === "view"
            ? () => {
                if (item.scope.kind === "view") onEditView(item.scope.view);
              }
            : undefined
        }
        draggable={writable && entry !== undefined}
        dropSide={drop?.key === key ? drop.side : undefined}
        onDragStart={(event) => {
          dragged.current = entry;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", key);
          // Choosing the entry the tab shows again would drop its issue pages.
          if (!selected || !sameScope(item.scope, selected))
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
        onSelect={(click) => {
          if (opensInNewTab(click)) onSelectInNewTab(item.scope);
          else onSelect(item.scope);
        }}
      />
    );
  }
  /** What an entry's context menu offers: Open in New Tab, then its actions. */
  function menuOf(item: SidebarItem): MenuItem[] {
    return [
      {
        label: "Open in New Tab",
        onClick: () => {
          onSelectInNewTab(item.scope);
        },
      },
      ...actionsOf(item),
    ];
  }
  /** What an entry's context menu offers besides Open in New Tab. */
  function actionsOf(item: SidebarItem): MenuItem[] {
    const { scope } = item;
    if (scope.kind === "view") {
      return [
        {
          label: "Edit view…",
          onClick: () => {
            onEditView(scope.view);
          },
        },
        {
          label: "Duplicate view…",
          disabled: !writable,
          onClick: () => {
            onDuplicateView(scope.view);
          },
        },
        {
          label: "Remove view…",
          disabled: !writable,
          onClick: () => {
            onRemoveView(scope.view);
          },
        },
      ];
    }
    if (scope.kind !== "repository") return [];
    const { repository } = scope;
    const unavailable = "unavailable" in item ? item.unavailable : undefined;
    const retry: MenuItem = {
      label: "Retry",
      onClick: () => {
        onSelect(scope);
        void window.verdandi.retry({ kind: "list", scope });
      },
    };
    const remove: MenuItem = {
      label: "Remove repository…",
      disabled: !writable,
      onClick: () => {
        onRemoveRepository(repository);
      },
    };
    if (!unavailable) return [remove];
    // Its address would open the repository that took it over.
    if (unavailable.nameTakenOver)
      return [
        retry,
        remove,
        {
          label: `Track the new ${repositoryLabel(repository)}`,
          disabled: !writable,
          onClick: () => {
            onTrackNewRepository(repository);
          },
        },
      ];
    return [
      retry,
      {
        label: "Open on GitHub",
        onClick: () => {
          window.desktop.openExternal(
            `https://github.com/${repository.owner}/${repository.name}`,
          );
        },
      },
      remove,
    ];
  }
  const inSection = (section: ScopePresentation["entry"]["section"]) =>
    items.filter((item) => presentScope(item.scope).entry.section === section);
  const repositories = inSection("repositories");
  const views = inSection("views");

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
        <ConfigProblems />
        {settingsError && (
          <p role="alert" className="px-2 py-1 break-words text-destructive">
            {settingsError}
          </p>
        )}
        <SectionHeading
          action={
            sidebar?.status === "read" && (
              <button
                type="button"
                aria-label="Add repository"
                title="Add repository (a)"
                onClick={onAddRepository}
                className="-my-1 rounded px-1 text-sm leading-none text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              >
                +
              </button>
            )
          }
        >
          Repositories
        </SectionHeading>
        {sidebar === undefined ? null : sidebar.status === "failed" ? (
          <p
            role="alert"
            className="px-2 py-1 break-words whitespace-pre-line text-destructive"
          >
            {sidebar.message}
          </p>
        ) : repositories.length === 0 ? (
          <button
            type="button"
            onClick={onAddRepository}
            className="w-full rounded-md px-2 py-1 text-left text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            Add repository…
          </button>
        ) : (
          <ul
            role="listbox"
            aria-label="Repositories"
            className="flex flex-col gap-px"
          >
            {repositories.map(renderEntry)}
          </ul>
        )}
        <SectionHeading
          action={
            sidebar?.status === "read" && (
              <button
                type="button"
                aria-label="New view"
                title="New view (v)"
                onClick={onNewView}
                className="-my-1 rounded px-1 text-sm leading-none text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              >
                +
              </button>
            )
          }
        >
          Views
        </SectionHeading>
        {sidebar?.status === "read" && views.length === 0 ? (
          <button
            type="button"
            onClick={onNewView}
            className="w-full rounded-md px-2 py-1 text-left text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          >
            New view…
          </button>
        ) : (
          <ul
            role="listbox"
            aria-label="Views"
            className="flex flex-col gap-px"
          >
            {views.map(renderEntry)}
          </ul>
        )}
      </nav>
      <Account setup={setup} />
    </>
  );
}

function SectionHeading({
  children,
  action,
}: {
  children: string;
  /** A button beside the heading, such as **+**. */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-2 pt-3 pb-1 first:pt-1">
      <h2 className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
        {children}
      </h2>
      {action}
    </div>
  );
}

/** An action in an entry's context menu. */
interface MenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * An entry: All with its icon, a tracked repository's name with its owner
 * on a second line, or a view's name with its icon; then the open-issue
 * count, a view's match count, or the entry's shortcut while the modifier
 * is held.
 */
function Entry({
  item,
  login,
  menu,
  onEdit,
  selected,
  focused,
  shortcut,
  onSelect,
  draggable,
  dropSide,
  ...dragHandlers
}: {
  item: SidebarItem;
  login: string | undefined;
  /** The entry's context menu. */
  menu: MenuItem[];
  /** Edits the entry on double-click, if it can be edited. */
  onEdit: (() => void) | undefined;
  selected: boolean;
  focused: boolean;
  shortcut: string | undefined;
  /** Selects the entry, or opens it in a new tab, as the click asks. */
  onSelect: (click: MouseEvent) => void;
  draggable: boolean;
  dropSide: "before" | "after" | undefined;
  onDragStart: React.DragEventHandler<HTMLLIElement>;
  onDragOver: React.DragEventHandler<HTMLLIElement>;
  onDrop: React.DragEventHandler<HTMLLIElement>;
  onDragEnd: React.DragEventHandler<HTMLLIElement>;
}) {
  const { scope } = item;
  const { description, entry } = presentScope(scope);
  const unavailable = "unavailable" in item ? item.unavailable : undefined;
  const reason = unavailable
    ? problemText(
        unavailable,
        login,
        scope.kind === "repository" ? scope.repository : undefined,
      )
    : undefined;
  const row = (
    <li
      role="option"
      aria-selected={selected}
      title={description}
      onClick={onSelect}
      onDoubleClick={onEdit}
      draggable={draggable}
      {...dragHandlers}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1 select-none",
        dropSide === "before" && "border-t-2 border-t-ring",
        dropSide === "after" && "border-b-2 border-b-ring",
        entry.section === "repositories" ? "min-h-10" : "min-h-8",
        selected
          ? focused
            ? "bg-selection shadow-[inset_2px_0_0_var(--selection-edge)]"
            : "bg-sidebar-accent text-sidebar-accent-foreground"
          : "hover:bg-sidebar-accent",
      )}
    >
      {entry.section === "pinned" ? (
        <>
          <AllIcon className="size-4 shrink-0 text-muted-foreground" />
          <span
            className={cn("min-w-0 flex-1 truncate", selected && "font-medium")}
          >
            {entry.name}
          </span>
        </>
      ) : entry.section === "views" ? (
        <>
          <ListFilter
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span
            className={cn("min-w-0 flex-1 truncate", selected && "font-medium")}
          >
            {entry.name}
          </span>
        </>
      ) : (
        <span
          className={cn(
            "flex min-w-0 flex-1 flex-col leading-tight",
            unavailable && "opacity-60",
          )}
        >
          <span className={cn("truncate", selected && "font-medium")}>
            {entry.name}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {entry.owner}
          </span>
        </span>
      )}
      {shortcut ? (
        <kbd className="shrink-0 rounded border border-b-2 bg-background px-1 font-mono text-2xs text-muted-foreground">
          {shortcut}
        </kbd>
      ) : reason ? (
        <span title={[reason.text, reason.detail].filter(Boolean).join(" · ")}>
          <TriangleAlert
            aria-label={reason.text}
            className="size-4 shrink-0 text-warning"
          />
        </span>
      ) : "matches" in item ? (
        item.matches.status === "rejected" ? (
          <span title={`GitHub rejected this search: ${item.matches.message}`}>
            <TriangleAlert
              aria-label="GitHub rejected this search"
              className="size-4 shrink-0 text-warning"
            />
          </span>
        ) : (
          <span
            title={
              item.matches.status === "known"
                ? "Matches in the last run"
                : "Not run yet"
            }
            className="shrink-0 text-xs text-muted-foreground tabular-nums"
          >
            {matchCountLabel(item.matches)}
          </span>
        )
      ) : (
        <span
          title={
            item.openIssues.status === "failed"
              ? item.openIssues.message
              : undefined
          }
          className="shrink-0 text-xs text-muted-foreground tabular-nums"
        >
          {countLabel(item.openIssues)}
        </span>
      )}
    </li>
  );
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger render={row} />
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="z-50">
          <ContextMenu.Popup className="min-w-48 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none">
            {menu.map(({ label, onClick, disabled }) => (
              <ContextMenu.Item
                key={label}
                disabled={disabled}
                onClick={onClick}
                className="rounded px-2 py-1.5 outline-none data-highlighted:bg-accent data-disabled:opacity-50"
              >
                {label}
              </ContextMenu.Item>
            ))}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
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
 * is not confirmed, with GitHub's rate limits beside a known account. While
 * the setup blocker covers the app, it says nothing.
 */
function Account({ setup }: { setup: Setup | undefined }) {
  if (setup?.status === "blocked") return null;
  const label =
    setup?.status === "ready" ? accountLabel(setup.account) : undefined;
  const login =
    setup?.status === "ready" && setup.account.status === "known"
      ? setup.account.account.login
      : undefined;
  return (
    <footer className="flex items-center gap-2 border-t border-sidebar-border py-2 pr-2 pl-4 text-xs">
      {label === undefined ? (
        <p className="text-muted-foreground">Checking GitHub access…</p>
      ) : (
        <p
          title={label.detail}
          className={cn(
            "min-w-0 flex-1 truncate text-muted-foreground",
            label.detail !== undefined && "cursor-help",
          )}
        >
          {label.text}
        </p>
      )}
      {login !== undefined && <RateLimitsButton login={login} />}
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
