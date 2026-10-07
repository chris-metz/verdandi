import type {
  ConfigState,
  Setup,
  SidebarEntries,
} from "@verdandi/core/contract";
import { accountLabel } from "./account-label";

/** What the sidebar's warnings for the whole window come from. */
export interface WarningSources {
  sidebar: SidebarEntries | undefined;
  config: ConfigState | undefined;
  /** Why the last change to the settings failed to save, if it did. */
  settingsError: string | undefined;
  setup: Setup | undefined;
}

/**
 * The problems the sidebar shows for the whole window, one line each, for
 * the tab bar's button to name while the sidebar is hidden: `settings.json`
 * that cannot be read or written, values in `config.toml` that cannot be
 * used, a change to the settings that failed to save, an account not
 * confirmed, and a rate limit running low, as the rate-limits gauge says. A
 * warning on a single entry, such as an unavailable repository, is not one
 * of them.
 */
export function sidebarWarnings(
  { sidebar, config, settingsError, setup }: WarningSources,
  rateLimitLow: boolean,
): string[] {
  const settings = settingsProblem(sidebar);
  // The account, and the rate limits beside it, show while the setup is
  // ready; the rate limits only for a known account.
  const account = setup?.status === "ready" ? setup.account : undefined;
  const unconfirmed =
    account?.status === "unconfirmed" ? accountLabel(account) : undefined;
  return [
    ...(settings === undefined ? [] : [settings]),
    ...(config?.problems.map((problem) => problem.message) ?? []),
    ...(settingsError ? [settingsError] : []),
    ...(unconfirmed
      ? [[unconfirmed.text, unconfirmed.detail].filter(Boolean).join(" · ")]
      : []),
    ...(rateLimitLow && account?.status === "known"
      ? ["A GitHub rate limit is running low"]
      : []),
  ];
}

/** Why `settings.json` cannot be read or written, if it cannot. */
export function settingsProblem(
  sidebar: SidebarEntries | undefined,
): string | undefined {
  if (sidebar?.status === "failed") return sidebar.message;
  if (sidebar?.status === "read" && sidebar.settings.status !== "writable")
    return sidebar.settings.message;
  return undefined;
}
