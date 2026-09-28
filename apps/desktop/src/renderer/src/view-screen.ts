/**
 * How a view's header counts its matches, as GitHub counts them: "7
 * matches"; "100 of 4,213 matches shown" when fewer are listed; and the
 * pull requests among them, which are never listed.
 */
export function matchesLabel(
  { matchCount, pullRequests }: { matchCount: number; pullRequests: number },
  listed: number,
): string {
  const total = count(matchCount);
  const matches =
    listed + pullRequests < matchCount
      ? `${count(listed)} of ${total} matches shown`
      : `${total} ${matchCount === 1 ? "match" : "matches"}`;
  if (pullRequests === 0) return matches;
  return `${matches} · ${count(pullRequests)} ${pullRequests === 1 ? "pull request" : "pull requests"} not listed`;
}

function count(value: number): string {
  return value.toLocaleString("en-US");
}
