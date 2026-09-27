import { expect, it } from "vitest";
import { accountLabel } from "./account-label";

it("names the account and its host", () => {
  expect(accountLabel({ login: "octo-reader", host: "github.com" })).toBe(
    "@octo-reader · github.com",
  );
});
