import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Find, useFindSurface } from "./FindDialog";
import { emptyFind, type FindState } from "./find";

let root: Root;
let host: HTMLDivElement;
const scroll = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "Highlight",
    class extends Set<Range> {
      constructor(...ranges: Range[]) {
        super(ranges);
      }
    },
  );
  vi.stubGlobal("CSS", { highlights: new Map<string, Set<Range>>() });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scroll,
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(20, 100, 70, 20),
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 800, 600),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  scroll.mockClear();
});
afterEach(async () => {
  await flush(() => {
    root.unmount();
  });
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Harness({
  children,
  initial = { ...emptyFind, open: true },
}: {
  children: React.ReactNode;
  initial?: FindState;
}) {
  const [find, setFind] = useState(initial);
  return (
    <Find state={find} onChange={setFind}>
      {children}
    </Find>
  );
}
function getInput(): HTMLInputElement {
  const input = host.querySelector("input");
  if (!input) throw new Error("Find must be open");
  return input;
}
async function type(text: string) {
  await flush(() => {
    const input = getInput();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function key(key: string, shiftKey = false) {
  await flush(() =>
    getInput().dispatchEvent(
      new KeyboardEvent("keydown", { key, shiftKey, bubbles: true }),
    ),
  );
}
function count() {
  return host.querySelector('[role="status"]')?.textContent;
}
function activeText() {
  return [...(CSS.highlights.get("find-active") ?? [])].map((range) =>
    range instanceof Range ? range.toString() : "",
  );
}

it("finds from the first character, steps occurrences, keeps focus and never re-scrolls a surviving match on data updates", async () => {
  await flush(() => {
    root.render(
      <Harness>
        <div data-find-page="issue:91" data-pane-focus tabIndex={0}>
          <h1 data-find-field="title">ContractTests contract 91</h1>
        </div>
      </Harness>,
    );
  });
  await type("c");
  expect(count()).toBe("1/4");
  expect(document.activeElement).toBe(getInput());
  await type("co");
  expect(count()).toBe("1/2");
  await type("contract");
  expect(activeText()).toEqual(["Contract"]);
  await key("Enter");
  expect(count()).toBe("2/2");
  const scrolls = scroll.mock.calls.length;
  await flush(() => {
    root.render(
      <Harness>
        <div data-find-page="issue:91" data-pane-focus tabIndex={0}>
          <h1 data-find-field="title">ContractTests contract 91</h1>
          <p data-find-field="comment">contract arrived later</p>
        </div>
      </Harness>,
    );
  });
  expect(count()).toBe("2/3");
  expect(scroll.mock.calls).toHaveLength(scrolls);
  await key("Enter", true);
  expect(count()).toBe("1/3");
  await type("9");
  expect(count()).toBe("1/1");
  await type("");
  expect(count()).toBe("0/0");
  const afterClear = scroll.mock.calls.length;
  await key("Enter");
  expect(scroll.mock.calls).toHaveLength(afterClear);
  await key("Escape");
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(CSS.highlights.size).toBe(0);
  expect(host.querySelector("h1")?.textContent).toBe(
    "ContractTests contract 91",
  );
});

it("prefers the transferred field when content arrives and uses real text for a missing-field fallback", async () => {
  const initial = {
    ...emptyFind,
    open: true,
    query: "contract",
    transfer: { field: "label:contract", occurrence: 0 },
  };
  await flush(() => {
    root.render(
      <Harness initial={initial}>
        <div data-find-page="issue:91" />
      </Harness>,
    );
  });
  expect(count()).toBe("0/0");
  await flush(() => {
    root.render(
      <Harness initial={initial}>
        <div data-find-page="issue:91" data-find-primary>
          <h1 data-find-field="title">ContractTests</h1>
          <span data-find-field="label:contract">contract</span>
        </div>
      </Harness>,
    );
  });
  expect(count()).toBe("2/2");
  const selected = [...(CSS.highlights.get("find-active") ?? [])][0];
  expect(selected?.startContainer.parentElement?.dataset.findField).toBe(
    "label:contract",
  );
});

async function flush(action: () => void) {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}

it("does not repeat an old reveal when returning to a tab after a manual collapse", async () => {
  let saved: FindState = { ...emptyFind, open: true, query: "contract" };
  function Tab() {
    const [state, setState] = useState(saved);
    return (
      <Find
        state={state}
        onChange={(next) => {
          saved = next;
          setState(next);
        }}
      >
        <Page />
      </Find>
    );
  }
  function Page() {
    const [expanded, setExpanded] = useState(false);
    useFindSurface({
      reveal: () => {
        setExpanded(true);
      },
    });
    return (
      <div data-find-page="list:All">
        <div data-issue-id="91" hidden={!expanded}>
          <span data-find-field="title">contract</span>
        </div>
      </div>
    );
  }
  await flush(() => {
    root.render(<Tab />);
  });
  expect(host.querySelector<HTMLElement>('[data-issue-id="91"]')?.hidden).toBe(
    false,
  );
  await flush(() => {
    root.render(<div />);
  });
  // Another tab manually collapsed the shared branch while this one was away.
  await flush(() => {
    root.render(<Tab />);
  });
  expect(host.querySelector<HTMLElement>('[data-issue-id="91"]')?.hidden).toBe(
    true,
  );
});

it("keeps a revealed description section open after Escape and switching away and back", async () => {
  let saved: FindState = { ...emptyFind, open: true, query: "contract" };
  function Tab() {
    const [state, setState] = useState(saved);
    return (
      <Find
        state={state}
        onChange={(next) => {
          saved = next;
          setState(next);
        }}
      >
        <div data-find-page="issue:91">
          <div data-find-field="body">
            <details>
              <summary>More</summary>
              <p>contract</p>
            </details>
          </div>
        </div>
      </Find>
    );
  }
  await flush(() => {
    root.render(<Tab />);
  });
  expect(host.querySelector("details")?.open).toBe(true);
  await key("Escape");
  await flush(() => {
    root.render(<div />);
  });
  await flush(() => {
    root.render(<Tab />);
  });
  expect(host.querySelector("details")?.open).toBe(true);
  await flush(() => {
    const details = host.querySelector("details");
    if (details) details.open = false;
  });
  await flush(() => {
    root.render(<div />);
  });
  await flush(() => {
    root.render(<Tab />);
  });
  expect(host.querySelector("details")?.open).toBe(false);
});

it("reveals again when a match returns after an update left no matches", async () => {
  const initial = { ...emptyFind, open: true, query: "contract" };
  const page = (text: string) => (
    <Harness initial={initial}>
      <div data-find-page="issue:91">
        <h1 data-find-field="title">{text}</h1>
      </div>
    </Harness>
  );
  await flush(() => {
    root.render(page("contract"));
  });
  const first = scroll.mock.calls.length;
  await flush(() => {
    root.render(page("gone"));
  });
  expect(count()).toBe("0/0");
  await flush(() => {
    root.render(page("contract"));
  });
  expect(count()).toBe("1/1");
  expect(scroll.mock.calls.length).toBeGreaterThan(first);
});
