/**
 * PROTOTYPE (tabs), throwaway: three variants of the tab bar and the new
 * tab's page, switchable with `?variant=A|B|C` and the floating bar.
 *
 * - A: a browser-like tab strip on top; the new tab's page is the macOS Go to
 *   Issue palette, inline and centred.
 * - B: flat tabs in one slim row, `#12` before the title; the new tab's page
 *   shows recent issues as cards beside a form that picks a repository.
 * - C: compact tabs at the bottom of the main area; the new tab's page looks
 *   like a list, with a filter field, the other open tabs and recent issues.
 */
import type { RepositoryAddress } from "@verdandi/core/contract";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  FileText,
  Hash,
  History,
  List,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { IssueDestination } from "../issue-navigation";
import { linkTarget } from "../link-target";
import { presentScope, repositoryLabel } from "../scope";
import type { PrototypeTab } from "./tabs";
import {
  useNewTabSearch,
  type Destination,
  type NewTabSearch,
} from "./use-new-tab-search";

export type VariantKey = "D" | "A" | "B" | "C";

export const variants: readonly { key: VariantKey; name: string }[] = [
  { key: "D", name: "Chosen: tabs from B + wider page from A" },
  { key: "A", name: "Browser strip + palette" },
  { key: "B", name: "Flat tabs + cards and repository picker" },
  { key: "C", name: "Bottom tabs + list page" },
];

/** The variant in `?variant=`, kept there as it changes, without reloading. */
export function useVariant(): [VariantKey, (key: VariantKey) => void] {
  const [variant, setVariant] = useState<VariantKey>(() => {
    const key = new URLSearchParams(window.location.search).get("variant");
    return variants.find((each) => each.key === key)?.key ?? "D";
  });
  function set(key: VariantKey) {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", key);
    window.history.replaceState(null, "", url);
    setVariant(key);
  }
  return [variant, set];
}

// MARK: Tab titles

interface TabTitle {
  kind: "new" | "list" | "issue";
  title: string;
  /** `#12`, for an issue. */
  short?: string;
  tooltip: string;
}

function tabTitle(tab: PrototypeTab): TabTitle {
  const issue = tab.stack.at(-1)?.issue;
  if (issue) {
    const page = issue.url === undefined ? undefined : linkTarget(issue.url);
    const qualified =
      page?.kind === "issue"
        ? `${repositoryLabel(page.repository)}#${String(page.number)}`
        : issue.reference;
    const short =
      page?.kind === "issue" ? `#${String(page.number)}` : issue.reference;
    return {
      kind: "issue",
      title: issue.title,
      short,
      tooltip: `${qualified} ${issue.title}`,
    };
  }
  if (tab.scope) {
    const label = presentScope(tab.scope).label;
    return { kind: "list", title: label, tooltip: label };
  }
  return { kind: "new", title: "New Tab", tooltip: "New Tab" };
}

function TabIcon({ title }: { title: TabTitle }) {
  const Icon =
    title.kind === "issue" ? FileText : title.kind === "list" ? List : Plus;
  return <Icon className="size-3.5 shrink-0 opacity-70" />;
}

export interface TabBarProps {
  variant: VariantKey;
  tabs: readonly PrototypeTab[];
  activeId: number;
  onActivate: (id: number) => void;
  onClose: (id: number) => void;
  onNew: () => void;
  /** ⌘T or Ctrl+T. */
  newShortcut: string;
}

function CloseButton({
  shown,
  onClose,
  className,
}: {
  shown: boolean;
  onClose: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label="Close Tab"
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground",
        shown ? "visible" : "invisible group-hover:visible",
        className,
      )}
    >
      <X className="size-3" />
    </button>
  );
}

/** A tab's mouse handling: a click shows it, a middle click closes it. */
function tabHandlers(
  id: number,
  { onActivate, onClose }: Pick<TabBarProps, "onActivate" | "onClose">,
) {
  return {
    onMouseDown: (event: MouseEvent) => {
      if (event.button === 0) onActivate(id);
    },
    onAuxClick: (event: MouseEvent) => {
      if (event.button === 1) onClose(id);
    },
  };
}

export function TabBar(props: TabBarProps) {
  if (props.variant === "B" || props.variant === "D")
    return <FlatTabBar {...props} />;
  if (props.variant === "C") return <BottomTabBar {...props} />;
  return <StripTabBar {...props} />;
}

function StripTabBar(props: TabBarProps) {
  const { tabs, activeId, onClose, onNew, newShortcut } = props;
  return (
    <div
      role="tablist"
      className="flex h-10 shrink-0 items-end gap-0.5 border-b bg-sidebar px-2"
    >
      {tabs.map((tab) => {
        const title = tabTitle(tab);
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            title={title.tooltip}
            {...tabHandlers(tab.id, props)}
            className={cn(
              "group relative -mb-px flex h-8 max-w-56 min-w-0 flex-1 items-center gap-2 rounded-t-lg border px-3 text-xs select-none",
              active
                ? "border-border border-b-background bg-background text-foreground"
                : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <TabIcon title={title} />
            <span className="min-w-0 flex-1 truncate">{title.title}</span>
            <CloseButton
              shown={active}
              onClose={() => {
                onClose(tab.id);
              }}
            />
          </div>
        );
      })}
      <button
        type="button"
        aria-label="New Tab"
        title={`New Tab (${newShortcut})`}
        onClick={onNew}
        className="mb-1.5 ml-1 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}

function FlatTabBar(props: TabBarProps) {
  const { tabs, activeId, onClose, onNew, newShortcut } = props;
  return (
    <div
      role="tablist"
      className="flex h-9 shrink-0 items-stretch border-b bg-background"
    >
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabs.map((tab) => {
          const title = tabTitle(tab);
          const active = tab.id === activeId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              title={title.tooltip}
              {...tabHandlers(tab.id, props)}
              className={cn(
                "group relative flex max-w-64 min-w-32 flex-1 items-center gap-1.5 border-r px-3 text-xs select-none",
                active
                  ? "bg-muted/40 text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-selection-edge"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              )}
            >
              {title.kind === "issue" ? (
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {title.short}
                </span>
              ) : (
                <TabIcon title={title} />
              )}
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  active && "font-medium",
                )}
              >
                {title.title}
              </span>
              <CloseButton
                shown={active}
                onClose={() => {
                  onClose(tab.id);
                }}
              />
            </div>
          );
        })}
      </div>
      <button
        type="button"
        aria-label="New Tab"
        title={`New Tab (${newShortcut})`}
        onClick={onNew}
        className="flex shrink-0 items-center gap-1.5 border-l px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus className="size-3.5" />
        <kbd className="font-sans">{newShortcut}</kbd>
      </button>
    </div>
  );
}

function BottomTabBar(props: TabBarProps) {
  const { tabs, activeId, onClose, onNew, newShortcut } = props;
  return (
    <div
      role="tablist"
      className="flex h-8 shrink-0 items-stretch border-t bg-sidebar text-xs"
    >
      {tabs.map((tab) => {
        const title = tabTitle(tab);
        const active = tab.id === activeId;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            title={title.tooltip}
            {...tabHandlers(tab.id, props)}
            className={cn(
              "group flex max-w-52 min-w-0 items-center gap-1.5 border-r pr-1.5 pl-2.5 select-none",
              active
                ? "bg-background text-foreground shadow-[inset_0_-2px_0_var(--selection-edge)]"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            {title.kind === "issue" && (
              <span className="shrink-0 font-mono text-[11px] opacity-70">
                {title.short}
              </span>
            )}
            {title.kind !== "issue" && <TabIcon title={title} />}
            <span className="min-w-0 truncate">{title.title}</span>
            <CloseButton
              shown={active}
              onClose={() => {
                onClose(tab.id);
              }}
            />
          </div>
        );
      })}
      <button
        type="button"
        aria-label="New Tab"
        title={`New Tab (${newShortcut})`}
        onClick={onNew}
        className="grid w-8 shrink-0 place-items-center text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus className="size-3.5" />
      </button>
      <span className="flex-1" />
      <span className="flex items-center px-3 text-muted-foreground">
        ⌃Tab next · ⌃⇧Tab previous
      </span>
    </div>
  );
}

// MARK: New tab's page

export interface NewTabPageProps {
  variant: VariantKey;
  tab: PrototypeTab;
  tabs: readonly PrototypeTab[];
  tracked: readonly RepositoryAddress[];
  login: string | undefined;
  onOpen: (
    issue: IssueDestination,
    repository: RepositoryAddress | undefined,
  ) => void;
  onActivate: (id: number) => void;
}

export function NewTabPage(props: NewTabPageProps) {
  // A new tab's page starts afresh, also when the variant changes.
  const key = `${props.variant}:${String(props.tab.id)}`;
  if (props.variant === "B") return <CardsPage key={key} {...props} />;
  if (props.variant === "C") return <ListPage key={key} {...props} />;
  return <PalettePage key={key} wide={props.variant === "D"} {...props} />;
}

function StatusLine({ search }: { search: NewTabSearch }) {
  const { status, hint } = search;
  const text =
    status.kind === "looking-up"
      ? `Looking up ${status.label}…`
      : status.kind === "failed"
        ? status.text
        : hint;
  if (!text) return null;
  return (
    <p
      role="status"
      className={cn(
        "px-3 py-2 text-xs",
        status.kind === "failed" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {text}
    </p>
  );
}

function destinationParts(destination: Destination) {
  if (destination.kind === "look-up") {
    const label = `${repositoryLabel(destination.repository)}#${String(destination.number)}`;
    return {
      key: `look-up:${label}`,
      number: `#${String(destination.number)}`,
      title: `Go to ${label}`,
      repository: repositoryLabel(destination.repository),
    };
  }
  const { recent } = destination;
  return {
    key: recent.issue.id,
    number: recent.number === undefined ? "" : `#${String(recent.number)}`,
    title: recent.issue.title,
    repository: recent.repository ? repositoryLabel(recent.repository) : "",
  };
}

function KeyHint({ keys, children }: { keys: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="rounded border bg-muted px-1 font-sans text-[11px]">
        {keys}
      </kbd>
      {children}
    </span>
  );
}

/** A: the macOS palette, inline and centred. */
function PalettePage({
  tab,
  login,
  onOpen,
  wide = false,
}: NewTabPageProps & { wide?: boolean }) {
  const search = useNewTabSearch({ from: tab.from, login, onOpen });
  const { destinations, highlighted } = search;
  const firstRecent = destinations.findIndex((each) => each.kind === "recent");
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pt-[14vh] pb-16">
      <div className={cn("w-full", wide ? "max-w-3xl" : "max-w-xl")}>
        <div className="flex h-14 items-center gap-3 rounded-2xl border bg-card px-4 shadow-sm focus-within:ring-3 focus-within:ring-ring/40">
          <Hash className="size-5 shrink-0 text-muted-foreground" />
          <input
            data-pane-focus
            autoFocus
            value={search.text}
            onChange={(event) => {
              search.setText(event.target.value);
            }}
            onKeyDown={search.onKeyDown}
            placeholder={
              tab.from
                ? `#12 in ${repositoryLabel(tab.from)}, owner/name#12 or a link`
                : "owner/name#12 or a link to an issue"
            }
            className="min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-muted-foreground"
          />
          {search.status.kind === "looking-up" && (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
        </div>
        <StatusLine search={search} />
        <div className="mt-3 space-y-0.5">
          {destinations.map((destination, index) => {
            const parts = destinationParts(destination);
            const active = index === highlighted;
            return (
              <div key={parts.key}>
                {index === firstRecent && (
                  <div className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">
                    Recent
                  </div>
                )}
                <div
                  onMouseEnter={() => {
                    search.setHighlighted(index);
                  }}
                  onClick={() => void search.go(destination)}
                  className={cn(
                    "flex h-9 items-center gap-3 rounded-lg px-3",
                    active && "bg-selection",
                  )}
                >
                  {destination.kind === "look-up" ? (
                    <ArrowRight className="size-4 shrink-0 text-primary" />
                  ) : (
                    <History className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
                    {parts.number}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{parts.title}</span>
                  <span
                    className={cn(
                      "shrink-0 truncate text-xs text-muted-foreground",
                      wide ? "max-w-80" : "max-w-40",
                    )}
                  >
                    {parts.repository}
                  </span>
                  <CornerDownLeft
                    className={cn(
                      "size-3.5 shrink-0 text-muted-foreground",
                      !active && "invisible",
                    )}
                  />
                </div>
              </div>
            );
          })}
          {!search.hasRecents && search.text === "" && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              The issues you open appear here.
            </p>
          )}
        </div>
        <div className="mt-6 flex justify-center gap-4 text-xs text-muted-foreground">
          <KeyHint keys="↑↓">Choose</KeyHint>
          <KeyHint keys="↩">Open</KeyHint>
          <KeyHint keys="⌃Tab">Next tab</KeyHint>
        </div>
      </div>
    </div>
  );
}

/** B: recent issues as cards, beside a form that picks a repository. */
function CardsPage({ tab, tracked, login, onOpen }: NewTabPageProps) {
  const [repository, setRepository] = useState<RepositoryAddress | undefined>(
    tab.from ?? tracked[0],
  );
  const search = useNewTabSearch({ from: repository, login, onOpen });
  const recents = search.destinations.filter(
    (each): each is Extract<Destination, { kind: "recent" }> =>
      each.kind === "recent",
  );
  const typed = search.destinations.find((each) => each.kind === "look-up");
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_19rem] gap-6 overflow-y-auto p-6">
      <section className="min-w-0">
        <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Recently opened
        </h2>
        {recents.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {search.text === ""
              ? "The issues you open appear here, to open again in this tab."
              : "No recent issue matches."}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
            {recents.map((destination) => {
              const { recent } = destination;
              return (
                <button
                  key={recent.issue.id}
                  type="button"
                  onClick={() => void search.go(destination)}
                  className="flex flex-col gap-1.5 rounded-xl border bg-card p-3 text-left hover:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
                >
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {recent.label}
                  </span>
                  <span className="line-clamp-2 text-sm font-medium">
                    {recent.issue.title}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
      <aside className="flex flex-col gap-3 self-start rounded-xl border bg-sidebar p-4">
        <h2 className="font-medium">Open an issue</h2>
        <div className="text-xs text-muted-foreground">Repository</div>
        <div
          role="radiogroup"
          className="max-h-56 overflow-y-auto rounded-lg border bg-background py-1"
        >
          {tracked.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No tracked repositories.
            </p>
          )}
          {tracked.map((each) => {
            const checked =
              repository !== undefined &&
              repositoryLabel(each) === repositoryLabel(repository);
            return (
              <button
                key={repositoryLabel(each)}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => {
                  setRepository(each);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
                  checked ? "bg-selection" : "hover:bg-muted",
                )}
              >
                <span
                  className={cn(
                    "size-2.5 shrink-0 rounded-full border",
                    checked && "border-selection-edge bg-selection-edge",
                  )}
                />
                <span className="truncate">{repositoryLabel(each)}</span>
              </button>
            );
          })}
        </div>
        <div className="text-xs text-muted-foreground">
          Number, owner/name#12 or a link
        </div>
        <div className="flex gap-2">
          <div className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border bg-background px-2 focus-within:ring-3 focus-within:ring-ring/40">
            <Hash className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              data-pane-focus
              autoFocus
              value={search.text}
              onChange={(event) => {
                search.setText(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (search.text.trim() !== "")
                    void search.go(typed ?? search.destinations[0]);
                }
              }}
              placeholder="Number"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            />
          </div>
          <button
            type="button"
            disabled={search.text.trim() === ""}
            onClick={() => void search.go(typed ?? search.destinations[0])}
            className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
          >
            {search.status.kind === "looking-up" ? "Looking up…" : "Open"}
          </button>
        </div>
        <StatusLine search={search} />
      </aside>
    </div>
  );
}

/** C: a page like a list: a filter field, the other tabs, recent issues. */
function ListPage({ tab, tabs, login, onOpen, onActivate }: NewTabPageProps) {
  const search = useNewTabSearch({ from: tab.from, login, onOpen });
  const others = tabs.filter((each) => each.id !== tab.id && !each.isNew);
  const query = search.text.trim().toLowerCase();
  const matchingTabs = others.filter((each) =>
    tabTitle(each).tooltip.toLowerCase().includes(query),
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b">
        <div className="flex min-h-12 items-center gap-2 py-1.5 pr-2 pl-4">
          <h1 className="font-medium">New Tab</h1>
          <span className="text-xs text-muted-foreground">
            {tab.from
              ? `#12 goes to ${repositoryLabel(tab.from)}`
              : "Type owner/name#12 or paste a link"}
          </span>
        </div>
        <div className="px-4 pb-3">
          <div className="flex h-8 items-center gap-2 rounded-md border bg-background px-2 focus-within:ring-3 focus-within:ring-ring/40">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              data-pane-focus
              autoFocus
              value={search.text}
              onChange={(event) => {
                search.setText(event.target.value);
              }}
              onKeyDown={search.onKeyDown}
              placeholder="Filter recent issues and tabs, or go to #12"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            />
            {search.status.kind === "looking-up" && (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto pb-16">
        <StatusLine search={search} />
        {matchingTabs.length > 0 && (
          <>
            <SectionHeading>Open tabs</SectionHeading>
            {matchingTabs.map((each) => {
              const title = tabTitle(each);
              return (
                <div
                  key={each.id}
                  onClick={() => {
                    onActivate(each.id);
                  }}
                  className="flex h-8 items-center gap-2 pr-4 pl-4 hover:bg-muted/50"
                >
                  <TabIcon title={title} />
                  {title.short && (
                    <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
                      {title.short}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{title.title}</span>
                  <span className="text-xs text-muted-foreground">Switch</span>
                </div>
              );
            })}
          </>
        )}
        {search.destinations.length > 0 && (
          <SectionHeading>
            {search.destinations[0]?.kind === "look-up"
              ? "Go to"
              : "Recently opened"}
          </SectionHeading>
        )}
        {search.destinations.map((destination, index) => {
          const parts = destinationParts(destination);
          const active = index === search.highlighted;
          return (
            <div key={parts.key}>
              {index === 1 && search.destinations[0]?.kind === "look-up" && (
                <SectionHeading>Recently opened</SectionHeading>
              )}
              <div
                onMouseEnter={() => {
                  search.setHighlighted(index);
                }}
                onClick={() => void search.go(destination)}
                className={cn(
                  "flex h-8 items-center gap-2 pr-4 pl-4",
                  active &&
                    "bg-selection shadow-[inset_2px_0_0_var(--selection-edge)]",
                )}
              >
                {destination.kind === "look-up" ? (
                  <ArrowRight className="size-3.5 shrink-0 text-primary" />
                ) : (
                  <History className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
                  {parts.number}
                </span>
                <span className="min-w-0 flex-1 truncate">{parts.title}</span>
                {parts.repository && (
                  <span className="shrink-0 rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {parts.repository}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {!search.hasRecents && search.text === "" && others.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            The issues you open appear here.
          </p>
        )}
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">
      {children}
    </div>
  );
}

// MARK: Switcher

/** The floating bar that switches variants; only in development. */
export function PrototypeSwitcher({
  variant,
  onChange,
}: {
  variant: VariantKey;
  onChange: (key: VariantKey) => void;
}) {
  const index = variants.findIndex((each) => each.key === variant);
  const step = (by: number) => {
    const next = variants[(index + by + variants.length) % variants.length];
    if (next) onChange(next.key);
  };
  // ⌥⌘← / ⌥⌘→ cycle, as plain arrows belong to the lists.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.altKey || !(event.metaKey || event.ctrlKey)) return;
      if (event.key === "ArrowLeft") step(-1);
      else if (event.key === "ArrowRight") step(1);
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  });
  if (!import.meta.env.DEV) return null;
  return (
    <div className="fixed bottom-12 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-zinc-900 px-1.5 py-1 text-xs text-white shadow-lg ring-1 ring-white/10">
      <button
        type="button"
        aria-label="Previous variant"
        onClick={() => {
          step(-1);
        }}
        className="grid size-6 place-items-center rounded-full hover:bg-white/15"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="px-2 whitespace-nowrap">
        Prototype {variant} ({variants[index]?.name}) · ⌥⌘←/→
      </span>
      <button
        type="button"
        aria-label="Next variant"
        onClick={() => {
          step(1);
        }}
        className="grid size-6 place-items-center rounded-full hover:bg-white/15"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
