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

it("says which account GitHub is read as now, and that what shows is read again", () => {
  expect(
    noticeText({
      kind: "account-changed",
      previous: { login: "octo-reader", host: "github.com" },
      account: { login: "octo-writer", host: "github.com" },
    }),
  ).toBe(
    "gh switched from @octo-reader to @octo-writer. Verdandi now reads GitHub as @octo-writer and loads what it shows again.",
  );
});
