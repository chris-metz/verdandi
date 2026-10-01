import { expect, it } from "vitest";
import { accountLabel } from "./account-label";

it("names the account and its host", () => {
  expect(
    accountLabel({
      status: "known",
      account: { login: "octo-reader", host: "github.com" },
      tokenSource: "stored",
    }),
  ).toEqual({ text: "@octo-reader · github.com", detail: undefined });
});

it("names the environment variable whose token overrides gh's stored account, and why switching gh's account may not help", () => {
  expect(
    accountLabel({
      status: "known",
      account: { login: "octo-bot", host: "github.com" },
      tokenSource: "GH_TOKEN",
    }),
  ).toEqual({
    text: "@octo-bot · github.com · GH_TOKEN",
    detail:
      "Verdandi reads GitHub with the token in GH_TOKEN, which overrides the account gh has stored. Switching gh's account, e.g. with gh auth switch, may not change it: change GH_TOKEN where Verdandi is started, then restart Verdandi.",
  });
});

it("says why the account is not confirmed", () => {
  expect(
    accountLabel({
      status: "unconfirmed",
      message: "GitHub CLI (gh) failed: error connecting to api.github.com",
    }),
  ).toEqual({
    text: "github.com · account not confirmed",
    detail: "GitHub CLI (gh) failed: error connecting to api.github.com",
  });
});
