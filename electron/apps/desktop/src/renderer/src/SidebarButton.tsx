import { PanelLeft } from "lucide-react";
import { budgetGauge } from "./rate-limit-budgets";
import { useRateLimitBudgets } from "./RateLimitsButton";
import { sidebarWarnings, type WarningSources } from "./sidebar-warnings";
import { useNow } from "./use-now";

/**
 * The button at the left end of the tab bar that hides and shows the
 * sidebar, as the View menu's item does; its tooltip names what it does and
 * the shortcut. While the sidebar is hidden and would show a problem for the
 * whole window, a dot in the warning colour marks the button, and the
 * tooltip says what the problem is.
 */
export function SidebarButton({
  hidden,
  shortcut,
  onToggle,
  ...sources
}: {
  hidden: boolean;
  /** ⌃⌘S, or Ctrl+B. */
  shortcut: string;
  onToggle: () => void;
} & WarningSources) {
  const rateLimitLow = budgetGauge(useRateLimitBudgets(), useNow()).low;
  const warnings = hidden ? sidebarWarnings(sources, rateLimitLow) : [];
  const action = hidden ? "Show Sidebar" : "Hide Sidebar";
  return (
    <button
      type="button"
      aria-label={action}
      aria-description={warnings.length > 0 ? warnings.join("\n") : undefined}
      title={[`${action} (${shortcut})`, ...warnings].join("\n")}
      // The keyboard stays where it is.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onToggle}
      className="relative flex shrink-0 items-center border-r px-3 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <PanelLeft aria-hidden className="size-4" />
      {warnings.length > 0 && (
        <span
          aria-hidden
          className="absolute top-1.5 right-2 size-2 rounded-full bg-warning ring-2 ring-background"
        />
      )}
    </button>
  );
}
