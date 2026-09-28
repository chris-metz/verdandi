import type { Notice } from "@verdandi/core/contract";

/** What a notice tells the user. */
export function noticeText(notice: Notice): string {
  return `The gh you chose at ${notice.previous} is gone or no longer works. Verdandi now uses ${notice.gh.path}.`;
}
