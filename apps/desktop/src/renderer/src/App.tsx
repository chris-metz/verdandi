import type { Scope } from "@verdandi/core/contract";
import { useState } from "react";
import { IssueListPane } from "./IssueListPane";
import { repositoryLabel } from "./scope";
import { Sidebar } from "./Sidebar";

export function App() {
  const [selected, setSelected] = useState<Scope>();
  return (
    <div className="flex h-screen text-sm">
      <Sidebar selected={selected} onSelect={setSelected} />
      <main className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          // A new scope starts from a fresh list, never the previous one's.
          <IssueListPane
            key={repositoryLabel(selected.repository)}
            scope={selected}
          />
        ) : (
          <p className="m-auto text-muted-foreground">Select a repository.</p>
        )}
      </main>
    </div>
  );
}
