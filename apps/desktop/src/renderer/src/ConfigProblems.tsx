import { useState } from "react";
import { useConfig } from "./config";

/**
 * What in `config.toml` Verdandi cannot use, and what it uses instead, until
 * the file is fixed; then it goes by itself.
 */
export function ConfigProblems() {
  const state = useConfig();
  const [error, setError] = useState<string>();
  if (!state || state.problems.length === 0) return null;
  return (
    <div className="my-2 rounded-md border border-warning/50 p-2 text-xs">
      <ul role="alert" className="flex flex-col gap-1 break-words">
        {state.problems.map((problem, index) => (
          <li key={index}>{problem.message}</li>
        ))}
      </ul>
      <button
        type="button"
        className="mt-2 rounded border px-2 py-1 hover:bg-sidebar-accent"
        onClick={() => {
          setError(undefined);
          window.desktop.showConfigFile().catch((cause: unknown) => {
            setError(cause instanceof Error ? cause.message : String(cause));
          });
        }}
      >
        Show file
      </button>
      {error && (
        <p role="alert" className="mt-2 break-words text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
