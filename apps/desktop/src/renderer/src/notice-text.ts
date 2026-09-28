import type { Notice } from "@verdandi/core/contract";

/** What a notice tells the user. */
export function noticeText(notice: Notice): string {
  switch (notice.kind) {
    case "gh-replaced":
      return `The gh you chose at ${notice.previous} is gone or no longer works. Verdandi now uses ${notice.gh.path}.`;
    case "account-changed": {
      const { previous, account } = notice;
      return `gh switched from @${previous.login} to @${account.login}. Verdandi now reads GitHub as @${account.login} and loads what it shows again.`;
    }
  }
}
