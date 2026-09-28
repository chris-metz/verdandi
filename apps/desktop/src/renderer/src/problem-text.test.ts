import { describe, expect, it } from "vitest";
import { problemText } from "./problem-text";

const samlMessage =
  "Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization.";

describe("how a problem reads", () => {
  it("says GitHub cannot be reached, with gh's own words as detail", () => {
    expect(
      problemText({
        kind: "unreachable",
        message: "dial tcp: lookup api.github.com: no such host",
      }),
    ).toEqual({
      text: "Cannot reach GitHub",
      detail: "dial tcp: lookup api.github.com: no such host",
      link: undefined,
    });
  });

  it("says what GitHub will not show is unavailable, naming the account, never why it cannot know", () => {
    expect(
      problemText({ kind: "unavailable", access: undefined }, "octo-reader"),
    ).toEqual({
      text: "Unavailable or not accessible with this account (@octo-reader)",
      detail: undefined,
      link: undefined,
    });
    expect(problemText({ kind: "unavailable", access: undefined })).toEqual({
      text: "Unavailable or not accessible with this account",
      detail: undefined,
      link: undefined,
    });
  });

  it("gives GitHub's reason and link for SSO only as GitHub gave them", () => {
    const url = "https://github.com/orgs/acme/sso?authorization_request=A1B2";
    expect(
      problemText({
        kind: "unavailable",
        access: { kind: "sso", message: samlMessage, url },
      }),
    ).toEqual({
      text: "Unavailable or not accessible with this account",
      detail: samlMessage,
      link: { label: "Authorize on GitHub", url },
    });
    expect(
      problemText({
        kind: "unavailable",
        access: { kind: "sso", message: samlMessage, url: undefined },
      }).link,
    ).toBeUndefined();
  });

  it("gives GitHub's reason for an organization's OAuth App restrictions, without a link", () => {
    const message =
      "Although you appear to have the correct authorization credentials, the `acme` organization has enabled OAuth App access restrictions.";
    expect(
      problemText({
        kind: "unavailable",
        access: { kind: "organization-approval", message },
      }),
    ).toEqual({
      text: "Unavailable or not accessible with this account",
      detail: message,
      link: undefined,
    });
  });

  it("says a rate limit is reached", () => {
    expect(
      problemText({
        kind: "rate-limited",
        message: "API rate limit exceeded for user ID 1234567.",
      }),
    ).toEqual({
      text: "GitHub rate limit reached",
      detail: "API rate limit exceeded for user ID 1234567.",
      link: undefined,
    });
  });

  it("says anything else in the core's words", () => {
    expect(
      problemText({
        kind: "error",
        message: "GitHub failed to answer: Server Error",
      }),
    ).toEqual({
      text: "GitHub failed to answer: Server Error",
      detail: undefined,
      link: undefined,
    });
  });
});
