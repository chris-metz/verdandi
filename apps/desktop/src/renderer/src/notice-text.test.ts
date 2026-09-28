import { expect, it } from "vitest";
import { noticeText } from "./notice-text";

it("says which gh replaced the one the user chose", () => {
  expect(
    noticeText({
      kind: "gh-replaced",
      previous: "/opt/tools/gh",
      gh: { path: "/opt/homebrew/bin/gh", version: "2.101.0" },
    }),
  ).toBe(
    "The gh you chose at /opt/tools/gh is gone or no longer works. Verdandi now uses /opt/homebrew/bin/gh.",
  );
});
