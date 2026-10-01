import type { AccountStatus } from "@verdandi/core/contract";

/**
 * How the window names the account Verdandi reads GitHub as: the account and
 * its host, and where the token comes from when an environment variable
 * overrides gh's stored account; `detail` says more on hover. The token
 * itself is never shown.
 */
export function accountLabel(status: AccountStatus): {
  text: string;
  detail: string | undefined;
} {
  if (status.status === "unconfirmed") {
    return {
      text: "github.com · account not confirmed",
      detail: status.message,
    };
  }
  const { account, tokenSource } = status;
  const text = `@${account.login} · ${account.host}`;
  if (tokenSource === "stored") return { text, detail: undefined };
  return {
    text: `${text} · ${tokenSource}`,
    detail: `Verdandi reads GitHub with the token in ${tokenSource}, which overrides the account gh has stored. Switching gh's account, e.g. with gh auth switch, may not change it: change ${tokenSource} where Verdandi is started, then restart Verdandi.`,
  };
}
