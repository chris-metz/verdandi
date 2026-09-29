# Load closed issues in full and filter labels locally

A tracked repository and All can show their closed issues instead of their open ones. When they do, Verdandi reads every closed issue of each repository the same way it reads the open ones: through the GraphQL repository connection, 100 per page, with no cap and no visible pagination. It does this only once the user first switches to closed. The list fills in as the pages arrive. A label filter is applied locally to what has been loaded, in views too, and never becomes part of a GitHub query. We chose this because a list is a forest: to place an issue under its parent issue and show its sub-issues, Verdandi needs the whole scope, not one page of it. A label filter over a partial set would silently miss issues.

## Considered Options

- **Page through closed issues as GitHub does**: the newest N plus "Load more", with sorting and label filtering done by the search API (`is:closed label:bug`). This is cheap for large repositories. But an issue on page 2 can belong in a tree on page 1. The search API also stops at 1,000 results and costs a request per filter change. It would also give lists two different filtering models.
- **Append `label:` to a view's search text**: this would be exact beyond the 1,000-match ceiling, but it re-runs the search on every click. Local filtering is instant, and the existing "may match" marking covers incomplete search results.

## Consequences

- A repository with many closed issues costs about 3 GraphQL points per 100 issues on every refresh, because a refresh re-reads every page. 20,000 closed issues is about 600 points.
- The existing budget floor turns automatic refresh off below 10% of the budget.
- If large repositories strain the budget, the fix is an incremental refresh. It is not paging or search.
- Closed lists stand by closing date, most recent first. GraphQL cannot order the connection that way, so the order is applied locally, like the rest of the forest.
