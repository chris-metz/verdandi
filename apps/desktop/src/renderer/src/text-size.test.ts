import type { ConfigState } from "@verdandi/core/contract";
import { beforeEach, expect, it } from "vitest";
import type { RendererContract } from "../../shared/ipc";
import { followTextSize, showTextSize } from "./text-size";

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement("html");
});

/** `config.toml` with this text size, as the core reads it. */
function state(textSize: number): ConfigState {
  return {
    config: {
      appearance: "system",
      lightTheme: "github-light",
      darkTheme: "github-dark",
      interfaceFont: null,
      codeFont: null,
      textSize,
    },
    file: "/home/octo/.config/verdandi/config.toml",
    status: "read",
    problems: [],
  };
}

it("shows a text size as its scale of 14px", () => {
  showTextSize(root, 21);
  expect(root.style.getPropertyValue("--text-scale")).toBe("1.5");
  showTextSize(root, 14);
  expect(root.style.getPropertyValue("--text-scale")).toBe("1");
});

it("shows the chosen text size once read, and each change of it", async () => {
  let push: ((next: ConfigState) => void) | undefined;
  const { ready, stop } = followTextSize(root, {
    getConfig: () => Promise.resolve(state(21)),
    on: ((_: "configChanged", listener: (next: ConfigState) => void) => {
      push = listener;
      return () => {
        push = undefined;
      };
    }) as Pick<RendererContract, "on">["on"],
  });
  await ready;
  expect(root.style.getPropertyValue("--text-scale")).toBe("1.5");
  push?.(state(7));
  expect(root.style.getPropertyValue("--text-scale")).toBe("0.5");
  stop();
});
