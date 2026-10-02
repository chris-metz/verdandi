import type { RecentIssue, RepositoryAddress } from "@verdandi/core/contract";
import { GoToIssuePalette } from "./GoToIssueDialog";

/**
 * A new tab: the Go to Issue palette, inline and centred, wide enough that
 * repository names are not cut off. The issue chosen opens in this tab.
 */
export function NewTabPane({
  from,
  login,
  hasKeyboard,
  onChoose,
}: {
  /** The repository a bare `#12` names: that of the tab it was opened from. */
  from: RepositoryAddress | undefined;
  login: string | undefined;
  hasKeyboard: boolean;
  onChoose: (issue: RecentIssue) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pt-[14vh] pb-16">
      <div className="w-full max-w-3xl">
        <GoToIssuePalette
          from={from}
          login={login}
          inline
          hasKeyboard={hasKeyboard}
          onChoose={onChoose}
        />
      </div>
    </div>
  );
}
