import { TriangleAlert } from "lucide-react";
import type { CheckoutsOn } from "./sidebar-entries";
import { machineFailures } from "./checkouts";

/**
 * Checkouts' sidebar entry: how many checkouts have a main branch behind
 * GitHub and how many have commits not on GitHub, nothing while all are up
 * to date, and a warning while a machine could not be read.
 */
export function CheckoutsCount({ checkouts }: { checkouts: CheckoutsOn }) {
  const { behind, ahead } = checkouts;
  const failures = machineFailures(checkouts);
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
      {failures.length > 0 && (
        <span title={failures.join("\n")}>
          <TriangleAlert
            aria-label="A machine could not be read"
            className="size-4 text-warning"
          />
        </span>
      )}
      {behind > 0 && (
        <span
          title={`${String(behind)} ${behind === 1 ? "checkout has" : "checkouts have"} a main branch behind GitHub, the worktrees of one checkout counting once`}
          className="text-selection-edge"
        >
          ↓{behind}
        </span>
      )}
      {ahead > 0 && (
        <span
          title={`${String(ahead)} ${ahead === 1 ? "checkout has" : "checkouts have"} commits on a main branch not on GitHub, the worktrees of one checkout counting once`}
          className="text-warning"
        >
          ↑{ahead}
        </span>
      )}
    </span>
  );
}
