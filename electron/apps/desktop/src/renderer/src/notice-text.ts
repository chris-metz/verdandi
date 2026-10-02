import type { Notice, SavedView } from "@verdandi/core/contract";
import { repositoryLabel } from "./scope";

/** A notice of the window's own, beside the core's. */
export interface WindowNotice {
  /** An issue number typed was a pull request's, which opened on GitHub. */
  kind: "pull-request-opened";
  /** `owner/name#12`. */
  reference: string;
}

/** What a notice tells the user. */
export function noticeText(notice: Notice | WindowNotice): string {
  switch (notice.kind) {
    case "pull-request-opened":
      return `${notice.reference} is a pull request, which Verdandi does not show, so it opened on GitHub.`;
    case "gh-replaced":
      return `The gh you chose at ${notice.previous} is gone or no longer works. Verdandi now uses ${notice.gh.path}.`;
    case "account-changed": {
      const { previous, account } = notice;
      return `gh switched from @${previous.login} to @${account.login}. Verdandi now reads GitHub as @${account.login} and loads what it shows again.`;
    }
    case "repositories-renamed":
      return `${series(
        notice.renamed.map(
          ({ from, to }) =>
            `${repositoryLabel(from)} is now ${repositoryLabel(to)}`,
        ),
      )}.`;
    case "duplicate-repositories-removed":
      return notice.removed
        .map(
          ({ repository, sameAs }) =>
            `${repositoryLabel(repository)} was removed from the sidebar: settings.json listed it as the same repository as ${repositoryLabel(sameAs)}.`,
        )
        .join(" ");
  }
}

/**
 * The views a notice offers to open, each once, with what they have in
 * common: after a rename, those whose search still names an old address,
 * which GitHub's search does not follow.
 */
export function noticeViews(
  notice: Notice | WindowNotice,
): { label: string; views: SavedView[] } | undefined {
  if (notice.kind !== "repositories-renamed") return undefined;
  const views = new Map<string, SavedView>();
  for (const rename of notice.renamed) {
    for (const view of rename.views) views.set(view.id, view);
  }
  if (views.size === 0) return undefined;
  const [only] = notice.renamed;
  return {
    label:
      notice.renamed.length === 1 && only
        ? `Views still searching repo:${repositoryLabel(only.from)}:`
        : "Views still searching an old address:",
    views: [...views.values()],
  };
}

/** "a", "a, and b", or "a, b, and c": each part a clause of its own. */
function series(parts: string[]): string {
  if (parts.length <= 2) return parts.join(", and ");
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1) ?? ""}`;
}
