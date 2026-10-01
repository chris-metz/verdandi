import type {
  RepositoryEntry,
  TrackedRepository,
} from "@verdandi/core/contract";
import { IssueListPane } from "./IssueListPane";
import { IssuePagePane } from "./IssuePagePane";
import type { IssueNavigation, IssueVisit } from "./issue-navigation";
import { presentScope, type SidebarScope as Scope } from "./scope";
import { ViewPane } from "./ViewPane";

/**
 * One sidebar entry's list and the issue pages opened from it. A label
 * clicked on a page returns to the list, filtered by it.
 */
export function MainArea({
  scope,
  stack,
  login,
  onNavigate,
  hasKeyboard,
  repositories,
  onSelectRepository,
  onRemoveRepository,
  onTrackNewRepository,
  onEditView,
  onGoToIssue,
}: {
  scope: Scope;
  repositories: readonly RepositoryEntry[];
  onSelectRepository: (repository: TrackedRepository) => void;
  onRemoveRepository: ((repository: TrackedRepository) => void) | undefined;
  onTrackNewRepository: (repository: TrackedRepository) => void;
  /** Opens the view dialog for the view shown. */
  onEditView: () => void;
  /** Opens the Go to issue dialog, where it is available. */
  onGoToIssue: (() => void) | undefined;
  /** The issue pages opened from the list, the one shown last. */
  stack: readonly IssueVisit[];
  /** The account GitHub is read as, if known. */
  login: string | undefined;
  onNavigate: (action: IssueNavigation) => void;
  hasKeyboard: boolean;
}) {
  const current = stack.at(-1);
  if (!current)
    return scope.kind === "view" ? (
      <ViewPane
        view={scope.view}
        login={login}
        hasKeyboard={hasKeyboard}
        onEdit={onEditView}
        onOpen={(issue) => {
          onNavigate({ kind: "open", issue });
        }}
      />
    ) : (
      <IssueListPane
        scope={scope}
        repositories={repositories}
        onSelectRepository={onSelectRepository}
        onRemoveRepository={onRemoveRepository}
        onTrackNewRepository={onTrackNewRepository}
        login={login}
        hasKeyboard={hasKeyboard}
        onOpen={(issue) => {
          onNavigate({ kind: "open", issue });
        }}
        onGoToIssue={onGoToIssue}
      />
    );
  return (
    <IssuePagePane
      key={`${String(stack.length)}:${current.issue.id}`}
      visit={current}
      previous={stack.at(-2)?.issue}
      listLabel={presentScope(scope).label}
      login={login}
      hasKeyboard={hasKeyboard}
      onNavigate={onNavigate}
      onGoToIssue={onGoToIssue}
      onFilterLabel={(label) => {
        void window.verdandi.addLabelToFilter(
          scope.kind === "view"
            ? { kind: "view", viewId: scope.view.id }
            : scope,
          label,
        );
        onNavigate({ kind: "list" });
      }}
    />
  );
}
