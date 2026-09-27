import type { AccountStatus } from "@verdandi/core/contract";
import { useEffect, useState } from "react";
import { accountLabel } from "./account-label";

export function App() {
  const account = useAccount();
  return (
    <main className="flex h-screen items-center justify-center p-8 text-sm">
      {account === undefined ? (
        <p className="text-muted-foreground">Checking GitHub access…</p>
      ) : account.status === "known" ? (
        <p>{accountLabel(account.account)}</p>
      ) : (
        <p
          role="alert"
          className="max-w-prose whitespace-pre-line text-destructive"
        >
          {account.message}
        </p>
      )}
    </main>
  );
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
