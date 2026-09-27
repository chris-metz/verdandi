import type { IssueList, Scope } from "@verdandi/core/contract";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { IssueStateIcon } from "./IssueStateIcon";
import { listStatus } from "./list-status";
import { repositoryLabel, sameScope } from "./scope";

/** The main area's list of the selected scope, filled as pages arrive. */
export function IssueListPane({ scope }: { scope: Scope }) {
  const list = useList(scope);
  const failed = list?.loading.status === "failed";
  return (
    <>
      <header className="flex h-12 shrink-0 items-center border-b px-4">
        <h1 className="truncate font-medium">
          {repositoryLabel(scope.repository)}
        </h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {list && (
          <>
            <ul>
              {list.issues.map((issue) => (
                <li key={issue.id} className="flex h-8 items-center gap-2 px-4">
                  <IssueStateIcon state={issue.state} />
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    #{issue.number}
                  </span>
                  <span className="truncate">{issue.title}</span>
                </li>
              ))}
            </ul>
            <p
              role={failed ? "alert" : "status"}
              className={cn(
                "px-4 py-3 whitespace-pre-line text-muted-foreground",
                failed && "text-destructive",
              )}
            >
              {listStatus(list)}
            </p>
          </>
        )}
      </div>
    </>
  );
}

/** The scope's list as the core pushes it, from the moment it is opened. */
function useList(scope: Scope): IssueList | undefined {
  const [list, setList] = useState<IssueList>();
  useEffect(() => {
    let current = true;
    // The core pushes every list that changes, not only this one.
    const unsubscribe = window.verdandi.on("listChanged", (changed) => {
      if (sameScope(changed.scope, scope)) setList(changed);
    });
    window.verdandi.openList(scope).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (current) {
        setList({ scope, issues: [], loading: { status: "failed", message } });
      }
    });
    return () => {
      current = false;
      unsubscribe();
    };
  }, [scope]);
  return list;
}
