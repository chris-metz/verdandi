import type { Scope } from "@verdandi/core/contract";
import { describe, expect, it } from "vitest";
import {
  commandForWindowKey,
  entryShortcut,
  shortcutModifier,
  tabStepForKey,
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

describe("s", () => {
  it("switches a repository's or All's list between open and closed, whichever pane has the keyboard", () => {
    expect(press(key("s"), { focused: "sidebar", selected: "api" })).toEqual({
      kind: "switch-state",
    });
    expect(press(key("s"), { focused: "main", selected: "api" })).toEqual({
      kind: "switch-state",
    });
    expect(
      commandForWindowKey(key("s"), {
        focused: "main",
        entries,
        selected: { kind: "all" },
        modifier: macOS,
      }),
    ).toEqual({ kind: "switch-state" });
  });

  it("does nothing in a view, whose state comes from its search", () => {
    expect(
      commandForWindowKey(key("s"), {
        focused: "main",
        entries,
        selected: {
          kind: "view",
          view: { id: "bugs", name: "Bugs", query: "label:bug" },
        },
        modifier: macOS,
      }),
    ).toBeUndefined();
  });

  it("is left alone with ⌘, Ctrl or Alt, or with nothing selected", () => {
    expect(
      press(key("s", { metaKey: true }), { selected: "api" }),
    ).toBeUndefined();
    expect(
      press(key("s", { ctrlKey: true }), { selected: "api" }),
    ).toBeUndefined();
    expect(
      press(key("s", { altKey: true }), { selected: "api" }),
    ).toBeUndefined();
    expect(press(key("s"))).toBeUndefined();
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

describe("#", () => {
  const goToIssue = { kind: "go-to-issue" };

  it("opens the Go to Issue dialog over the tab shown, whichever pane has the keyboard", () => {
    expect(press(key("#"), { focused: "sidebar", selected: "api" })).toEqual(
      goToIssue,
    );
    expect(press(key("#"), { focused: "main", selected: "api" })).toEqual(
      goToIssue,
    );
  });

  it("works with ⇧ held, as for Shift+3 on a US keyboard", () => {
    expect(
      press(
        { ...key("#", { shiftKey: true }), code: "Digit3" },
        {
          selected: "api",
        },
      ),
    ).toEqual(goToIssue);
  });

  it("works in All and in a view too", () => {
    const all = { kind: "all" } as const;
    const bugs = {
      kind: "view",
      view: { id: "bugs", name: "Bugs", query: "label:bug" },
    } as const;
    for (const selected of [all, bugs]) {
      expect(
        commandForWindowKey(key("#"), {
          focused: "sidebar",
          entries: [all, ...entries, bugs],
          selected,
          modifier: macOS,
        }),
      ).toEqual(goToIssue);
    }
  });

  it("gives a new tab's field the keyboard", () => {
    expect(press(key("#"))).toEqual({ kind: "focus", pane: "main" });
  });

  it("is left alone with ⌘, Ctrl or Alt", () => {
    expect(
      press(key("#", { metaKey: true }), { selected: "api" }),
    ).toBeUndefined();
    expect(
      press(key("#", { ctrlKey: true }), { selected: "api" }),
    ).toBeUndefined();
    expect(
      press(key("#", { altKey: true }), { selected: "api" }),
    ).toBeUndefined();
  });
});

describe("switching tabs", () => {
  it("shows the next tab with Ctrl+Tab, and the previous with Ctrl+Shift+Tab, everywhere", () => {
    for (const platform of ["darwin", "win32", "linux"] as const) {
      expect(tabStepForKey(key("Tab", { ctrlKey: true }), platform)).toBe(1);
      expect(
        tabStepForKey(key("Tab", { ctrlKey: true, shiftKey: true }), platform),
      ).toBe(-1);
    }
  });

  it("shows the next and previous tab with ⌘⇧] and ⌘⇧[ on macOS", () => {
    const next = {
      ...key("}", { metaKey: true, shiftKey: true }),
      code: "BracketRight",
    };
    const previous = {
      ...key("{", { metaKey: true, shiftKey: true }),
      code: "BracketLeft",
    };
    expect(tabStepForKey(next, "darwin")).toBe(1);
    expect(tabStepForKey(previous, "darwin")).toBe(-1);
    expect(tabStepForKey(next, "linux")).toBeUndefined();
  });

  it("shows the next and previous tab with Ctrl+PageDown and Ctrl+PageUp elsewhere", () => {
    expect(tabStepForKey(key("PageDown", { ctrlKey: true }), "linux")).toBe(1);
    expect(tabStepForKey(key("PageUp", { ctrlKey: true }), "win32")).toBe(-1);
    expect(
      tabStepForKey(key("PageDown", { ctrlKey: true }), "darwin"),
    ).toBeUndefined();
  });

  it("leaves the keys alone with other modifiers, or none", () => {
    expect(tabStepForKey(key("Tab"), "darwin")).toBeUndefined();
    expect(
      tabStepForKey(key("Tab", { ctrlKey: true, altKey: true }), "darwin"),
    ).toBeUndefined();
    expect(
      tabStepForKey(key("Tab", { ctrlKey: true, metaKey: true }), "darwin"),
    ).toBeUndefined();
    expect(tabStepForKey(key("PageDown"), "linux")).toBeUndefined();
    expect(
      tabStepForKey(
        { ...key("]", { metaKey: true }), code: "BracketRight" },
        "darwin",
      ),
    ).toBeUndefined();
  });

  it("leaves Tab alone between the panes", () => {
    expect(
      press(key("Tab", { ctrlKey: true }), { selected: "api" }),
    ).toBeUndefined();
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

it("asks to remove a repository with unmodified Backspace in the sidebar", () => {
  expect(press(key("Backspace"), { selected: "api" })).toEqual({
    kind: "remove-repository",
    repository: { owner: "acme", name: "api" },
  });
  expect(press(key("Delete"), { selected: "api" })).toBeUndefined();
  expect(
    press(key("Backspace"), { selected: "api", focused: "main" }),
  ).toBeUndefined();
  for (const modifiers of [
    { metaKey: true },
    { ctrlKey: true },
    { altKey: true },
    { shiftKey: true },
  ]) {
    expect(
      press(key("Backspace", modifiers), { selected: "api" }),
    ).toBeUndefined();
  }
  const all = { kind: "all" as const };
  expect(
    commandForWindowKey(key("Backspace"), {
      focused: "sidebar",
      selected: all,
      entries: [all],
      modifier: macOS,
    }),
  ).toBeUndefined();
});

describe("views", () => {
  const bugs = {
    kind: "view" as const,
    view: { id: "bugs", name: "Bugs", query: "label:bug" },
  };
  function onView(
    pressed: KeyPress,
    focused: Pane = "sidebar",
    selected: Scope | typeof bugs = bugs,
  ) {
    return commandForWindowKey(pressed, {
      focused,
      selected,
      entries: [...entries, bugs],
      modifier: macOS,
    });
  }

  it("creates a view with v, whichever pane has the keyboard", () => {
    expect(onView(key("v"))).toEqual({ kind: "new-view" });
    expect(onView(key("v"), "main", repository("api"))).toEqual({
      kind: "new-view",
    });
    expect(onView(key("v", { metaKey: true }))).toBeUndefined();
  });

  it("duplicates the selected view with V, whichever pane has the keyboard", () => {
    const duplicate = { kind: "duplicate-view", view: bugs.view };
    expect(onView(key("V", { shiftKey: true }))).toEqual(duplicate);
    expect(onView(key("V", { shiftKey: true }), "main")).toEqual(duplicate);
    expect(
      onView(key("V", { shiftKey: true }), "main", repository("api")),
    ).toBeUndefined();
    expect(onView(key("V", { shiftKey: true, metaKey: true }))).toBeUndefined();
  });

  it("edits the selected view with E, whichever pane has the keyboard", () => {
    const edit = { kind: "edit-view", view: bugs.view };
    expect(onView(key("E", { shiftKey: true }))).toEqual(edit);
    expect(onView(key("E", { shiftKey: true }), "main")).toEqual(edit);
    expect(onView(key("e"), "sidebar")).toBeUndefined();
    expect(
      onView(key("E", { shiftKey: true }), "main", repository("api")),
    ).toBeUndefined();
  });

  it("edits the focused view with F2 in the sidebar", () => {
    expect(onView(key("F2"))).toEqual({ kind: "edit-view", view: bugs.view });
    expect(onView(key("F2"), "main")).toBeUndefined();
    expect(onView(key("F2"), "sidebar", repository("api"))).toBeUndefined();
  });

  it("asks to remove the focused view with unmodified Backspace in the sidebar", () => {
    expect(onView(key("Backspace"))).toEqual({
      kind: "remove-view",
      view: bugs.view,
    });
    expect(onView(key("Backspace"), "main")).toBeUndefined();
    expect(onView(key("Backspace", { metaKey: true }))).toBeUndefined();
  });
});
