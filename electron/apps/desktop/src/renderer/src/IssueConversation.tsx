import type {
  IssueComment,
  IssueComments,
  IssueMetadata,
  IssueSummary,
  Problem,
} from "@verdandi/core/contract";
import { memo } from "react";
import { Avatar } from "./Avatar";
import { ageOf, commentsStatus } from "./freshness";
import { GitHubHtml } from "./GitHubHtml";
import type { LinkToIssue } from "./link-target";
import { ProblemNotice } from "./ProblemNotice";
import { useNow } from "./use-now";

const linkButtonClass =
  "rounded px-1 underline-offset-2 hover:bg-muted hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring";

/**
 * An issue's body and its comments, as GitHub renders them, below the rest
 * of its page. Only comments show, not GitHub's timeline events. Each marks
 * a reading position, which stays in place as the page is read again.
 */
export function IssueConversation({
  issue,
  comments,
  login,
  onRetry,
  onOpenIssue,
}: {
  issue: IssueSummary & IssueMetadata;
  comments: IssueComments;
  /** The account GitHub is read as, if known, to name it when unavailable. */
  login: string | undefined;
  /** Reads what failed on the page again. */
  onRetry: () => void;
  /**
   * Opens an issue a link names in the app, answering why it could not, if
   * it could not.
   */
  onOpenIssue: (link: LinkToIssue) => Promise<Problem | undefined>;
}) {
  const status = commentsStatus(comments, issue.commentCount, useNow());
  const { loading } = comments;
  return (
    <>
      <section aria-label="Description" className="border-t px-6 py-5">
        <article
          data-scroll-anchor="body"
          className="rounded-md border px-4 py-3"
        >
          {issue.bodyHTML === "" ? (
            <p className="text-muted-foreground italic">
              No description provided.
            </p>
          ) : (
            <GitHubHtml
              html={issue.bodyHTML}
              url={issue.url}
              login={login}
              onOpenIssue={onOpenIssue}
              onRenewMedia={() =>
                window.verdandi.renewMediaLinks(issue.id, issue.id)
              }
            />
          )}
        </article>
      </section>
      <section aria-label="Comments" className="border-t px-6 pt-3 pb-7">
        <h2 className="mb-3 text-sm font-medium">
          Comments{" "}
          <span className="ml-1 text-muted-foreground">
            {issue.commentCount}
          </span>
        </h2>
        {comments.comments.length > 0 && (
          <ol className="space-y-4">
            {comments.comments.map((comment) => (
              <Comment
                key={comment.id}
                issueId={issue.id}
                comment={comment}
                login={login}
                onOpenIssue={onOpenIssue}
              />
            ))}
          </ol>
        )}
        {loading.status === "failed" && (
          <ProblemNotice
            problem={loading.problem}
            login={login}
            subject="Comments"
            url={issue.url}
            onRetry={onRetry}
          />
        )}
        {status && (
          <p
            role="status"
            className={
              status.retry
                ? "mt-3 text-xs text-warning"
                : "mt-3 text-muted-foreground"
            }
          >
            {status.text}
            {status.retry && (
              <>
                {" "}
                <button
                  type="button"
                  className={linkButtonClass}
                  onClick={onRetry}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className={linkButtonClass}
                  onClick={() => {
                    window.desktop.openExternal(issue.url);
                  }}
                >
                  Open on GitHub
                </button>
              </>
            )}
          </p>
        )}
      </section>
    </>
  );
}

/**
 * One comment: who wrote it and when, which opens it on GitHub, then its
 * body. It shows again only when it changed.
 */
const Comment = memo(function Comment({
  issueId,
  comment,
  login,
  onOpenIssue,
}: {
  /** The issue it is on. */
  issueId: string;
  comment: IssueComment;
  login: string | undefined;
  onOpenIssue: (link: LinkToIssue) => Promise<Problem | undefined>;
}) {
  const { author } = comment;
  return (
    <li
      data-scroll-anchor={`comment:${comment.id}`}
      className="rounded-md border"
    >
      <header className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        {author && <Avatar actor={author} className="size-5" />}
        <span className="font-medium text-foreground">
          {author ? `@${author.login}` : "Deleted user"}
        </span>
        <button
          type="button"
          title={new Date(comment.createdAt).toLocaleString()}
          className={linkButtonClass}
          onClick={() => {
            window.desktop.openExternal(comment.url);
          }}
        >
          commented {ageOf(comment.createdAt)}
        </button>
      </header>
      <div className="px-4 py-3">
        <GitHubHtml
          html={comment.bodyHTML}
          url={comment.url}
          login={login}
          onOpenIssue={onOpenIssue}
          onRenewMedia={() =>
            window.verdandi.renewMediaLinks(issueId, comment.id)
          }
        />
      </div>
    </li>
  );
});
