import { cn } from "@/lib/utils";

/** All's icon, layers stacked, wherever All is named. */
export function AllIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={cn("fill-none stroke-current stroke-[1.4]", className)}
    >
      <path d="M8 1.8 14.2 5 8 8.2 1.8 5z" />
      <path d="M1.8 8 8 11.2 14.2 8M1.8 11 8 14.2 14.2 11" />
    </svg>
  );
}
