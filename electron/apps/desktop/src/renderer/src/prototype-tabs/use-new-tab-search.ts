/**
 * PROTOTYPE (tabs), throwaway: what a new tab's field offers, as the macOS
 * app's Go to Issue does: the issue typed (`#12` in the repository the tab
 * was opened from, `owner/name#12`, `owner/name 12` or a link to an issue),
 * then the recent issues matching what is typed.
 */
import type { IssueLookup, RepositoryAddress } from "@verdandi/core/contract";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { IssueDestination } from "../issue-navigation";
import { linkTarget } from "../link-target";
import { problemText } from "../problem-text";
import { repositoryLabel } from "../scope";
import { useRecents, type RecentIssue } from "./recents";

export type Destination =
  | { kind: "recent"; recent: RecentIssue }
  | { kind: "look-up"; repository: RepositoryAddress; number: number };

export type SearchStatus =
  | { kind: "idle" }
  | { kind: "looking-up"; label: string }
  | { kind: "failed"; text: string };

function parse(
  text: string,
  from: RepositoryAddress | undefined,
): { repository: RepositoryAddress | undefined; number: number } | undefined {
  const trimmed = text.trim();
  const link = linkTarget(trimmed);
  if (link.kind === "issue")
    return { repository: link.repository, number: link.number };
  const qualified = /^([\w.-]+)\/([\w.-]+)\s*#?\s*(\d+)$/.exec(trimmed);
  if (qualified) {
    const [, owner = "", name = "", number = ""] = qualified;
    return { repository: { owner, name }, number: Number(number) };
  }
  const bare = /^#?(\d+)$/.exec(trimmed);
  if (bare) return { repository: from, number: Number(bare[1]) };
  return undefined;
}

function same(a: RepositoryAddress, b: RepositoryAddress): boolean {
  return repositoryLabel(a).toLowerCase() === repositoryLabel(b).toLowerCase();
}

export function useNewTabSearch({
  from,
  login,
  onOpen,
}: {
  from: RepositoryAddress | undefined;
  login: string | undefined;
  onOpen: (
    issue: IssueDestination,
    repository: RepositoryAddress | undefined,
  ) => void;
}) {
  const recents = useRecents();
  const [text, setTextState] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [status, setStatus] = useState<SearchStatus>({ kind: "idle" });
  const lookups = useRef(0);

  const parsed = parse(text, from);
  const typed = useMemo((): Destination | undefined => {
    if (!parsed?.repository) return undefined;
    const { repository, number } = parsed;
    const recent = recents.find(
      (each) =>
        each.repository !== undefined &&
        same(each.repository, repository) &&
        each.number === number,
    );
    return recent
      ? { kind: "recent", recent }
      : { kind: "look-up", repository, number };
  }, [parsed?.repository, parsed?.number, recents]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = text.trim().toLowerCase();
  const matching = recents.filter(
    (recent) =>
      query === "" ||
      recent.label.toLowerCase().includes(query) ||
      recent.issue.title.toLowerCase().includes(query),
  );
  const destinations: Destination[] = [
    ...(typed ? [typed] : []),
    ...matching
      .filter(
        (recent) =>
          !(
            typed?.kind === "recent" &&
            typed.recent.issue.id === recent.issue.id
          ),
      )
      .map((recent) => ({ kind: "recent" as const, recent })),
  ];
  const current = Math.min(highlighted, Math.max(destinations.length - 1, 0));

  /** Why nothing can be gone to, while something is typed. */
  const hint =
    query !== "" && destinations.length === 0
      ? parsed && !parsed.repository
        ? `Type owner/name#${String(parsed.number)}: this tab was not opened from a repository.`
        : "Type #12, owner/name#12 or a link to an issue on GitHub."
      : undefined;

  function setText(next: string) {
    setTextState(next);
    setHighlighted(0);
    setStatus({ kind: "idle" });
    lookups.current += 1;
  }

  async function go(destination = destinations[current]) {
    if (!destination) return;
    if (destination.kind === "recent") {
      const { recent } = destination;
      onOpen({ ...recent.issue, reference: recent.label }, recent.repository);
      return;
    }
    const { repository, number } = destination;
    const label = `${repositoryLabel(repository)}#${String(number)}`;
    const lookup = ++lookups.current;
    setStatus({ kind: "looking-up", label });
    let found: IssueLookup;
    try {
      found = await window.verdandi.lookUpIssue(repository, number);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      found = { status: "failed", problem: { kind: "error", message } };
    }
    if (lookup !== lookups.current) return;
    switch (found.status) {
      case "found":
        setStatus({ kind: "idle" });
        onOpen(found.issue, repository);
        break;
      case "pull-request":
        window.desktop.openExternal(found.url);
        setStatus({
          kind: "failed",
          text: `${label} is a pull request; it opened on GitHub.`,
        });
        break;
      case "failed":
        setStatus({
          kind: "failed",
          text: problemText(found.problem, login, repository).text,
        });
        break;
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const count = destinations.length;
    if (event.key === "ArrowDown" && count > 0) {
      event.preventDefault();
      setHighlighted((current + 1) % count);
    } else if (event.key === "ArrowUp" && count > 0) {
      event.preventDefault();
      setHighlighted((current - 1 + count) % count);
    } else if (event.key === "Enter") {
      event.preventDefault();
      void go();
    } else if (event.key === "Escape" && text !== "") {
      event.preventDefault();
      setText("");
    }
  }

  return {
    text,
    setText,
    destinations,
    highlighted: current,
    setHighlighted,
    status,
    hint,
    go,
    onKeyDown,
    hasRecents: recents.length > 0,
  };
}

export type NewTabSearch = ReturnType<typeof useNewTabSearch>;
