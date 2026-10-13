import { describe, expect, it } from "vitest";
import { findText, followTextMatch, stepTextMatch } from "./find";

describe("Find in loaded text", () => {
  it("follows the same occurrence when an edit shifts its position", () => {
    const before = findText(
      [{ key: "title", text: "contract contract" }],
      "contract",
    );
    const after = findText(
      [{ key: "title", text: "new contract contract" }],
      "contract",
    );
    expect(followTextMatch(before, after, before[1])).toEqual(after[1]);
  });
  it("retains an occurrence between several edited parts of the same field", () => {
    const before = findText(
      [{ key: "title", text: "contract prefix contract suffix" }],
      "contract",
    );
    const after = findText(
      [{ key: "title", text: "contract NEWprefix contract NEWsuffix" }],
      "contract",
    );
    expect(followTextMatch(before, after, before[1])).toEqual(after[1]);
  });
  it("retains a surviving occurrence through separate edits and added or removed matches", () => {
    const before = findText(
      [{ key: "body", text: "contract prefix contract suffix" }],
      "contract",
    );
    const added = findText(
      [{ key: "body", text: "contract NEWprefix contract NEWsuffix contract" }],
      "contract",
    );
    const removed = findText(
      [{ key: "body", text: "NEWprefix contract NEWsuffix" }],
      "contract",
    );
    expect(followTextMatch(before, added, before[1])).toEqual(added[1]);
    expect(followTextMatch(before, removed, before[1])).toEqual(removed[0]);
  });
  it("finds literal word parts from the first character and counts occurrences", () => {
    const fields = [
      { key: "91:title", text: "ContractTests contract [91]" },
      { key: "91:label", text: "contract" },
    ];
    expect(findText(fields, "c").map(({ start }) => start)).toEqual([
      0, 6, 14, 20, 0, 6,
    ]);
    expect(
      findText(fields, "CONTRACT").map(({ field, start, end }) => [
        field,
        start,
        end,
      ]),
    ).toEqual([
      ["91:title", 0, 8],
      ["91:title", 14, 22],
      ["91:label", 0, 8],
    ]);
    expect(findText(fields, "[")).toHaveLength(1);
    expect(findText(fields, "9")).toHaveLength(1);
    expect(findText(fields, "")).toEqual([]);
  });

  it("keeps the active location when content arrives and follows a removed occurrence forward, wrapping", () => {
    const before = findText(
      [
        { key: "title", text: "contract contract" },
        { key: "label", text: "contract" },
      ],
      "contract",
    );
    const after = findText(
      [
        { key: "new", text: "contract" },
        { key: "label", text: "contract" },
      ],
      "contract",
    );
    expect(followTextMatch(before, after, before[2])).toEqual(after[1]);
    expect(followTextMatch(before, after, before[1])).toEqual(after[1]);
    expect(followTextMatch(before, after.slice(0, 1), before[2])).toEqual(
      after[0],
    );
    expect(followTextMatch([], after, undefined)).toEqual(after[0]);
    expect(followTextMatch(before, [], before[0])).toBeUndefined();
    expect(stepTextMatch(before, before[0], -1)).toEqual(before[2]);
    expect(stepTextMatch(before, before[2], 1)).toEqual(before[0]);
  });
});
