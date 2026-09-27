import type { Account } from "@verdandi/core/contract";

/** How the window names the account Verdandi reads GitHub as. */
export function accountLabel(account: Account): string {
  return `@${account.login} · ${account.host}`;
}
