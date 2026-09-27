import type {
  AccountStatus,
  Scope,
  SidebarEntries,
} from "@verdandi/core/contract";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { accountLabel } from "./account-label";
import { repositoryLabel, sameScope } from "./scope";

/** The tracked repositories, in the settings file's order, and the account. */
export function Sidebar({
  selected,
  onSelect,
}: {
  selected: Scope | undefined;
  onSelect: (scope: Scope) => void;
}) {
  const sidebar = useSidebar();
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <nav aria-label="Sidebar" className="min-h-0 flex-1 overflow-y-auto p-2">
        <h2 className="px-2 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">
          Repositories
        </h2>
        {sidebar === undefined ? null : sidebar.status === "failed" ? (
          <p
            role="alert"
            className="px-2 py-1 break-words whitespace-pre-line text-destructive"
          >
            {sidebar.message}
          </p>
        ) : sidebar.repositories.length === 0 ? (
          <p className="px-2 py-1 text-muted-foreground">
            No tracked repositories
          </p>
        ) : (
          <ul className="flex flex-col gap-px">
            {sidebar.repositories.map((repository, index) => {
              const scope: Scope = { kind: "repository", repository };
              const isSelected =
                selected !== undefined && sameScope(scope, selected);
              return (
                <li key={`${String(index)}:${repositoryLabel(repository)}`}>
                  <button
                    type="button"
                    aria-current={isSelected ? "true" : undefined}
                    onClick={() => {
                      onSelect(scope);
                    }}
                    className={cn(
                      "w-full truncate rounded-md px-2 py-1 text-left hover:bg-sidebar-accent",
                      isSelected &&
                        "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                    )}
                  >
                    {repositoryLabel(repository)}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
      <Account />
    </aside>
  );
}

/** Which account Verdandi reads GitHub as, or why that is unknown. */
function Account() {
  const account = useAccount();
  return (
    <footer className="border-t border-sidebar-border px-4 py-2 text-xs">
      {account === undefined ? (
        <p className="text-muted-foreground">Checking GitHub access…</p>
      ) : account.status === "known" ? (
        <p className="truncate text-muted-foreground">
          {accountLabel(account.account)}
        </p>
      ) : (
        <p
          role="alert"
          className="break-words whitespace-pre-line text-destructive"
        >
          {account.message}
        </p>
      )}
    </footer>
  );
}

/** What the sidebar lists, once the core has read the settings file. */
function useSidebar(): SidebarEntries | undefined {
  const [sidebar, setSidebar] = useState<SidebarEntries>();
  useEffect(() => {
    let current = true;
    window.verdandi.getSidebar().then(
      (read) => {
        if (current) setSidebar(read);
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (current) setSidebar({ status: "failed", message });
      },
    );
    return () => {
      current = false;
    };
  }, []);
  return sidebar;
}

/** The account Verdandi reads GitHub as, once the core has asked. */
function useAccount(): AccountStatus | undefined {
  const [account, setAccount] = useState<AccountStatus>();
  useEffect(() => {
    let current = true;
    window.verdandi.getAccount().then(
      (status) => {
        if (current) setAccount(status);
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (current) setAccount({ status: "failed", message });
      },
    );
    const unsubscribe = window.verdandi.on("accountChanged", (changed) => {
      setAccount({ status: "known", account: changed });
    });
    return () => {
      current = false;
      unsubscribe();
    };
  }, []);
  return account;
}
