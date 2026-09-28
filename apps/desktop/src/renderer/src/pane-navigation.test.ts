import type { Scope } from "@verdandi/core/contract";
import { describe, expect, it } from "vitest";
import {
  commandForWindowKey,
  entryShortcut,
  shortcutModifier,
  type KeyPress,
  type Pane,
  type ShortcutModifier,
  type WindowCommand,
} from "./pane-navigation";

function repository(name: string): Scope {
  return { kind: "repository", repository: { owner: "acme", name } };
}

/** The sidebar's entries, in visual order. */
const entries = [repository("api"), repository("web"), repository("infra")];

const macOS = shortcutModifier("darwin");
const linux = shortcutModifier("linux");

/** A key pressed without modifiers unless given. */
function key(
  name: string,
  modifiers: Partial<Omit<KeyPress, "key">> = {},
): KeyPress {
  return {
    key: name,
    code: /^\d$/.test(name) ? `Digit${name}` : name,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

/** What a key does with one pane focused and an entry selected, by name. */
function press(
  pressed: KeyPress,
  {
    focused = "sidebar",
    selected,
    modifier = macOS,
  }: { focused?: Pane; selected?: string; modifier?: ShortcutModifier } = {},
): WindowCommand | undefined {
  return commandForWindowKey(pressed, {
    focused,
    entries,
    selected: selected === undefined ? undefined : repository(selected),
    modifier,
  });
}

function select(name: string): WindowCommand {
  return { kind: "select", scope: repository(name) };
}

describe("Tab", () => {
  it("moves the keyboard from the sidebar to the main area and back", () => {
    expect(press(key("Tab"), { focused: "sidebar" })).toEqual({
      kind: "focus",
      pane: "main",
    });
    expect(press(key("Tab"), { focused: "main" })).toEqual({
      kind: "focus",
      pane: "sidebar",
    });
  });

  it("does the same with ⇧, as there are only two panes", () => {
    expect(press(key("Tab", { shiftKey: true }), { focused: "main" })).toEqual({
      kind: "focus",
      pane: "sidebar",
    });
  });

  it("is left alone with ⌘, Ctrl or Alt", () => {
    expect(press(key("Tab", { ctrlKey: true }))).toBeUndefined();
    expect(press(key("Tab", { metaKey: true }))).toBeUndefined();
    expect(press(key("Tab", { altKey: true }))).toBeUndefined();
  });
});

describe("r", () => {
  it("refreshes what is on screen, whichever pane has the keyboard", () => {
    expect(press(key("r"), { focused: "sidebar" })).toEqual({
      kind: "refresh",
    });
    expect(press(key("r"), { focused: "main" })).toEqual({ kind: "refresh" });
  });

  it("is left alone with ⌘, Ctrl or Alt", () => {
    expect(press(key("r", { metaKey: true }))).toBeUndefined();
    expect(press(key("r", { ctrlKey: true }))).toBeUndefined();
    expect(press(key("r", { altKey: true }))).toBeUndefined();
  });
});

describe("a", () => {
  it("opens the repository picker, whichever pane has the keyboard", () => {
    expect(press(key("a"), { focused: "sidebar" })).toEqual({
      kind: "add-repository",
    });
    expect(press(key("a"), { focused: "main" })).toEqual({
      kind: "add-repository",
    });
  });

  it("is left alone with ⌘, Ctrl or Alt, and as A", () => {
    expect(press(key("a", { metaKey: true }))).toBeUndefined();
    expect(press(key("a", { ctrlKey: true }))).toBeUndefined();
    expect(press(key("a", { altKey: true }))).toBeUndefined();
    expect(press(key("A", { shiftKey: true }))).toBeUndefined();
  });
});

describe("sidebar keys", () => {
  it("select the entry below with j and ↓, stopping at the last", () => {
    expect(press(key("j"), { selected: "api" })).toEqual(select("web"));
    expect(press(key("ArrowDown"), { selected: "web" })).toEqual(
      select("infra"),
    );
    expect(press(key("j"), { selected: "infra" })).toBeUndefined();
  });

  it("select the entry above with k and ↑, stopping at the first", () => {
    expect(press(key("k"), { selected: "infra" })).toEqual(select("web"));
    expect(press(key("ArrowUp"), { selected: "web" })).toEqual(select("api"));
    expect(press(key("k"), { selected: "api" })).toBeUndefined();
  });

  it("select the first entry when none is selected", () => {
    expect(press(key("j"))).toEqual(select("api"));
    expect(press(key("ArrowUp"))).toEqual(select("api"));
  });

  it("are the list's keys while the main area has the keyboard", () => {
    for (const name of ["j", "k", "ArrowDown", "ArrowUp"]) {
      expect(
        press(key(name), { focused: "main", selected: "web" }),
      ).toBeUndefined();
    }
  });

  it("are left alone with ⌘, Ctrl or Alt", () => {
    expect(
      press(key("j", { altKey: true }), { selected: "api" }),
    ).toBeUndefined();
    expect(
      press(key("ArrowDown", { metaKey: true }), { selected: "api" }),
    ).toBeUndefined();
    expect(
      press(key("j", { ctrlKey: true }), { selected: "api" }),
    ).toBeUndefined();
  });

  it("do nothing in an empty sidebar", () => {
    expect(
      commandForWindowKey(key("j"), {
        focused: "sidebar",
        entries: [],
        selected: undefined,
        modifier: macOS,
      }),
    ).toBeUndefined();
  });

  it("ignore other keys", () => {
    expect(press(key("x"), { selected: "api" })).toBeUndefined();
    expect(press(key("Enter"), { selected: "api" })).toBeUndefined();
  });
});

describe("entry shortcuts", () => {
  it("select entries in visual order with ⌘1…9 on macOS, from either pane", () => {
    expect(press(key("1", { metaKey: true }), { focused: "main" })).toEqual(
      select("api"),
    );
    expect(press(key("3", { metaKey: true }), { focused: "sidebar" })).toEqual(
      select("infra"),
    );
  });

  it("select entries with Ctrl+1…9 on Linux and Windows", () => {
    expect(press(key("2", { ctrlKey: true }), { modifier: linux })).toEqual(
      select("web"),
    );
    expect(
      press(key("2", { metaKey: true }), { modifier: linux }),
    ).toBeUndefined();
    expect(
      press(key("2", { ctrlKey: true }), { modifier: macOS }),
    ).toBeUndefined();
  });

  it("go by the key's place, whatever the keyboard layout prints on it", () => {
    // On a French keyboard, the key for 1 types "&".
    expect(
      press(
        { ...key("&", { metaKey: true }), code: "Digit1" },
        { modifier: macOS },
      ),
    ).toEqual(select("api"));
  });

  it("select nothing past the last entry", () => {
    expect(press(key("4", { metaKey: true }))).toBeUndefined();
    expect(press(key("0", { metaKey: true }))).toBeUndefined();
  });

  it("are left alone with ⇧ or Alt as well", () => {
    expect(press(key("1", { metaKey: true, shiftKey: true }))).toBeUndefined();
    expect(press(key("1", { metaKey: true, altKey: true }))).toBeUndefined();
  });

  it("are shown while ⌘ is held on macOS, and Ctrl elsewhere", () => {
    expect(macOS.isHeld({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(macOS.isHeld({ metaKey: false, ctrlKey: true })).toBe(false);
    expect(linux.isHeld({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(linux.isHeld({ metaKey: true, ctrlKey: false })).toBe(false);
  });

  it("are named for the first nine entries", () => {
    expect(entryShortcut(0, macOS)).toBe("⌘1");
    expect(entryShortcut(8, macOS)).toBe("⌘9");
    expect(entryShortcut(0, linux)).toBe("Ctrl+1");
    expect(entryShortcut(9, macOS)).toBeUndefined();
  });
});

describe("All, pinned on top", () => {
  const all: Scope = { kind: "all" };
  const withAll = [all, ...entries];

  function pressWithAll(pressed: KeyPress, selected: Scope | undefined) {
    return commandForWindowKey(pressed, {
      focused: "sidebar",
      entries: withAll,
      selected,
      modifier: macOS,
    });
  }

  it("is selected with ⌘1, and the repositories with ⌘2 on", () => {
    expect(pressWithAll(key("1", { metaKey: true }), undefined)).toEqual({
      kind: "select",
      scope: all,
    });
    expect(pressWithAll(key("2", { metaKey: true }), all)).toEqual(
      select("api"),
    );
    expect(pressWithAll(key("4", { metaKey: true }), all)).toEqual(
      select("infra"),
    );
  });

  it("is left with j or ↓ for the first repository, and reached from it with k or ↑", () => {
    expect(pressWithAll(key("j"), all)).toEqual(select("api"));
    expect(pressWithAll(key("ArrowDown"), all)).toEqual(select("api"));
    expect(pressWithAll(key("k"), repository("api"))).toEqual({
      kind: "select",
      scope: all,
    });
    expect(pressWithAll(key("ArrowUp"), all)).toBeUndefined();
  });
});

it("moves the focused repository with Alt+arrows, keeping All fixed and stopping at section edges", () => {
  expect(press(key("ArrowUp", { altKey: true }), { selected: "web" })).toEqual({
    kind: "reorder",
    entry: repository("web"),
    destination: { direction: "up" },
  });
  expect(
    press(key("ArrowDown", { altKey: true }), { selected: "api" }),
  ).toEqual({
    kind: "reorder",
    entry: repository("api"),
    destination: { direction: "down" },
  });
  expect(
    press(key("ArrowUp", { altKey: true }), { selected: "api" }),
  ).toBeUndefined();
  expect(
    press(key("ArrowDown", { altKey: true }), { selected: "infra" }),
  ).toBeUndefined();
  expect(
    press(key("ArrowDown", { altKey: true }), {
      focused: "main",
      selected: "api",
    }),
  ).toBeUndefined();
  expect(
    commandForWindowKey(key("ArrowDown", { altKey: true }), {
      focused: "sidebar",
      entries: [{ kind: "all" }, ...entries],
      selected: { kind: "all" },
      modifier: macOS,
    }),
  ).toBeUndefined();
});

it("moves a view only within Views, even when views have the same name", () => {
  const first = {
    kind: "view" as const,
    view: { id: "one", name: "Bugs", query: "label:bug" },
  };
  const second = {
    kind: "view" as const,
    view: { id: "two", name: "Bugs", query: "label:bug is:open" },
  };
  const state = {
    focused: "sidebar" as const,
    entries: [...entries, first, second],
    selected: first,
    modifier: macOS,
  };
  expect(
    commandForWindowKey(key("ArrowUp", { altKey: true }), state),
  ).toBeUndefined();
  expect(
    commandForWindowKey(key("ArrowDown", { altKey: true }), state),
  ).toEqual({
    kind: "reorder",
    entry: { kind: "view", id: "one" },
    destination: { direction: "down" },
  });
});
