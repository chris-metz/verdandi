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

  it("says loading was interrupted", () => {
    expect(problemText({ kind: "interrupted" })).toEqual({
      text: "Loading was interrupted",
      detail: undefined,
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

describe("a tracked repository whose name another repository took over", () => {
  it("says so, naming the repository, rather than guessing why the tracked one is unavailable", () => {
    expect(
      problemText(
        { kind: "unavailable", access: undefined, nameTakenOver: true },
        "octo-reader",
        { owner: "acme", name: "api" },
      ),
    ).toEqual({
      text: "acme/api now names a different repository. The one you tracked is unavailable or not accessible with this account.",
      detail: undefined,
      link: undefined,
    });
  });
});
