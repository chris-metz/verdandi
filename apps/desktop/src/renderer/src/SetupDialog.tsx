import type { Setup, SetupProblem, UnusableGh } from "@verdandi/core/contract";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  setupGuidance,
  type GuidanceCommand,
  type GuidanceLink,
} from "./setup-guidance";

/**
 * The setup blocker: a modal dialog over the whole window while gh is missing
 * or unusable or its credentials are missing or rejected. It cannot be
 * dismissed; it goes once the core finds the setup ready, after **Check
 * again** or a chosen gh.
 */
export function SetupDialog({ problem }: { problem: SetupProblem }) {
  const platform = window.desktop.platform;
  const guidance = setupGuidance(problem, platform);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [rejected, setRejected] = useState<UnusableGh>();
  const primaryButton = useRef<HTMLButtonElement>(null);

  /** Runs one action at a time. */
  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function checkAgain() {
    void run(async () => {
      setRejected(undefined);
      await window.verdandi.checkSetupAgain();
    });
  }

  function choose() {
    void run(async () => {
      const choice = await window.desktop.chooseGhExecutable();
      if (choice.status === "canceled") return;
      setRejected(choice.status === "invalid" ? choice : undefined);
    });
  }

  const chooseFirst = guidance.primary === "choose";
  const chooseButton = (
    <Button
      key="choose"
      ref={chooseFirst ? primaryButton : undefined}
      variant={chooseFirst ? "default" : "outline"}
      disabled={busy}
      // The keyboard stays on it while it works.
      focusableWhenDisabled
      onClick={choose}
    >
      Choose gh executable…
    </Button>
  );
  const checkButton = (
    <Button
      key="check"
      ref={chooseFirst ? undefined : primaryButton}
      variant={chooseFirst ? "outline" : "default"}
      disabled={busy}
      focusableWhenDisabled
      onClick={checkAgain}
    >
      {busy ? "Checking…" : "Check again"}
    </Button>
  );

  return (
    <Dialog
      open
      disablePointerDismissal
      // Neither Esc nor anything else closes it: only a ready setup does.
      onOpenChange={() => undefined}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={primaryButton}
        className="flex max-h-[calc(100%-3rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <header className="flex items-center justify-between border-b px-6 py-4 font-semibold">
          GitHub setup
          <span className="text-xs font-normal text-muted-foreground">
            github.com
          </span>
        </header>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-5">
          <DialogTitle className="text-xl font-semibold">
            {guidance.title}
          </DialogTitle>
          <DialogDescription render={<div />} className="flex flex-col gap-4">
            {guidance.explanation.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </DialogDescription>
          {problem.kind !== "no-usable-gh" && (
            <p className="text-xs text-muted-foreground">
              Using GitHub CLI {problem.gh.version} at{" "}
              <code className="break-all text-foreground select-text">
                {problem.gh.path}
              </code>
            </p>
          )}
          {rejected && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2"
            >
              <p className="font-medium text-destructive">
                This file cannot be used as gh
              </p>
              <p className="mt-1 text-muted-foreground">{rejected.reason}</p>
              <code className="mt-1 block break-all text-xs select-text">
                {rejected.path}
              </code>
            </div>
          )}
          {problem.kind === "no-usable-gh" && problem.notUsable.length > 0 && (
            <NotUsable notUsable={problem.notUsable} />
          )}
          {guidance.commands.length > 0 && (
            <ul className="flex flex-col gap-2">
              {guidance.commands.map((command) => (
                <li key={command.command}>
                  <Command command={command} />
                </li>
              ))}
            </ul>
          )}
          {guidance.links.length > 0 && (
            <p className="flex flex-wrap gap-x-4 gap-y-1">
              {guidance.links.map((link) => (
                <ExternalLink key={link.url} link={link} />
              ))}
            </p>
          )}
          {problem.kind === "no-usable-gh" && (
            <details className="text-muted-foreground">
              <summary className="cursor-default text-foreground">
                gh works in my terminal
              </summary>
              <p className="mt-2">{guidance.terminalHint.explanation}</p>
              <div className="mt-2">
                <Command
                  command={{
                    label: "Find gh",
                    command: guidance.terminalHint.command,
                  }}
                />
              </div>
            </details>
          )}
        </div>
        <DialogFooter className="mx-0 mb-0 px-6 py-4">
          {/* The action offered first comes last, where the eye ends. */}
          {chooseFirst
            ? [checkButton, chooseButton]
            : [chooseButton, checkButton]}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The gh executables found but unusable, each with why. */
function NotUsable({ notUsable }: { notUsable: readonly UnusableGh[] }) {
  return (
    <div>
      <p className="font-medium">Found, but not usable:</p>
      <ul className="mt-1 flex flex-col gap-1">
        {notUsable.map(({ path, reason }) => (
          <li key={path} className="text-muted-foreground">
            <code className="break-all text-xs text-foreground select-text">
              {path}
            </code>
            {" — "}
            {reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A command to run in a terminal, with a button that copies it. */
function Command({ command }: { command: GuidanceCommand }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, 1500);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{command.label}</span>
      <div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-1.5">
        <code className="min-w-0 flex-1 font-mono text-xs break-all select-text">
          {command.command}
        </code>
        <Button
          variant="ghost"
          size="xs"
          aria-label={`Copy ${command.command}`}
          onClick={() => {
            void navigator.clipboard.writeText(command.command).then(() => {
              setCopied(true);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

/** A link that opens in the browser. */
function ExternalLink({ link }: { link: GuidanceLink }) {
  return (
    <a
      href={link.url}
      onClick={(event) => {
        event.preventDefault();
        window.desktop.openExternal(link.url);
      }}
      className="text-selection-edge underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      {link.label} ↗
    </a>
  );
}

/**
 * Whether Verdandi can read GitHub, as the core last said or pushed it. The
 * first read starts the check at startup.
 */
export function useSetup(): Setup | undefined {
  const [setup, setSetup] = useState<Setup>();
  useEffect(() => {
    let current = true;
    // A push is newer than the answer to a read that started before it.
    let pushed = false;
    const unsubscribe = window.verdandi.on("setupChanged", (changed) => {
      pushed = true;
      setSetup(changed);
    });
    void window.verdandi.getSetup().then((read) => {
      if (current && !pushed) setSetup(read);
    });
    return () => {
      current = false;
      unsubscribe();
    };
  }, []);
  return setup;
}
