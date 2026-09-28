import type {
  Scope,
  RepositoryEntry,
  TrackedRepository,
} from "@verdandi/core/contract";
import { IssueListPane } from "./IssueListPane";
import { IssuePagePane } from "./IssuePagePane";
import type { IssueNavigation, IssueVisit } from "./issue-navigation";
import { scopeLabel } from "./scope";

/** One sidebar entry's list and the issue pages opened from it. */
export function MainArea({
  scope,
  stack,
  login,
  onNavigate,
  hasKeyboard,
  repositories,
  onSelectRepository,
  onRemoveRepository,
}: {
  scope: Scope;
  repositories: readonly RepositoryEntry[];
  onSelectRepository: (repository: TrackedRepository) => void;
  onRemoveRepository: ((repository: TrackedRepository) => void) | undefined;
  /** The issue pages opened from the list, the one shown last. */
  stack: readonly IssueVisit[];
  /** The account GitHub is read as, if known. */
  login: string | undefined;
  onNavigate: (action: IssueNavigation) => void;
  hasKeyboard: boolean;
}) {
  const current = stack.at(-1);
  if (!current)
    return (
      <IssueListPane
        scope={scope}
        repositories={repositories}
        onSelectRepository={onSelectRepository}
        onRemoveRepository={onRemoveRepository}
        login={login}
        hasKeyboard={hasKeyboard}
        onOpen={(issue) => {
          onNavigate({ kind: "open", issue });
        }}
      />
    );
  return (
    <IssuePagePane
      key={`${String(stack.length)}:${current.issue.id}`}
      visit={current}
      previous={stack.at(-2)?.issue}
      listLabel={scopeLabel(scope)}
      login={login}
      hasKeyboard={hasKeyboard}
      onNavigate={onNavigate}
    />
  );
}
