import type { Scope } from "@verdandi/core/contract";
import { useReducer } from "react";
import { IssueListPane } from "./IssueListPane";
import { IssuePagePane } from "./IssuePagePane";
import { navigateIssues } from "./issue-navigation";
import { scopeLabel } from "./scope";

/** One sidebar entry's list and the issue pages opened from it. */
export function MainArea({
  scope,
  hasKeyboard,
}: {
  scope: Scope;
  hasKeyboard: boolean;
}) {
  const [stack, navigate] = useReducer(navigateIssues, []);
  const current = stack.at(-1);
  if (!current)
    return (
      <IssueListPane
        scope={scope}
        hasKeyboard={hasKeyboard}
        onOpen={(issue) => {
          navigate({ kind: "open", issue });
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
      onNavigate={navigate}
    />
  );
}
