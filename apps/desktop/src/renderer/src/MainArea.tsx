import type { Scope } from "@verdandi/core/contract";
import { IssueListPane } from "./IssueListPane";
import { IssuePagePane } from "./IssuePagePane";
import type { IssueNavigation, IssueVisit } from "./issue-navigation";
import { scopeLabel } from "./scope";

/** One sidebar entry's list and the issue pages opened from it. */
export function MainArea({
  scope,
  stack,
  onNavigate,
  hasKeyboard,
}: {
  scope: Scope;
  /** The issue pages opened from the list, the one shown last. */
  stack: readonly IssueVisit[];
  onNavigate: (action: IssueNavigation) => void;
  hasKeyboard: boolean;
}) {
  const current = stack.at(-1);
  if (!current)
    return (
      <IssueListPane
        scope={scope}
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
      hasKeyboard={hasKeyboard}
      onNavigate={onNavigate}
    />
  );
}
