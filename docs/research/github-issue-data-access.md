# GitHub issue data access

Research date: **2026-09-26**. Scope: GitHub.com, for [Research GitHub's API for sub-issues, blocking relationships and gh access](https://github.com/chris-metz/verdandi/issues/5), under [Map: Verdandi MVP spec](https://github.com/chris-metz/verdandi/issues/1). This records API facts, dated read-only observations, and possible approaches. It does not choose Verdandi's stack, data-access architecture, refresh policy, or presentation.

## Findings

GitHub exposes native sub-issue and blocking relationships through both APIs. GraphQL can load issue lists and adjacent relationships together; REST exposes separate relationship endpoints plus summaries. Search supports the required Boolean syntax when advanced search is explicitly selected, but search has completeness limits. An installed, authenticated `gh` can supply either the requests or credentials on all three target operating systems. These findings leave the choices between live queries and a local mirror, and between language/GUI stacks, open.

## Relationship APIs

Paths below are relative to `https://api.github.com/repos/{owner}/{repo}/issues/{number}`.

| Data | REST GET | GraphQL `Issue` field |
| --- | --- | --- |
| Immediate sub-issues | `/sub_issues` | `subIssues(first:, after:)` |
| Parent issue | `/parent` | `parent` (nullable `Issue`) |
| Progress | Issue payload: `sub_issues_summary` | `subIssuesSummary` |
| Issues blocking this issue | `/dependencies/blocked_by` | `blockedBy(first:, after:, orderBy:)` |
| Issues this issue blocks | `/dependencies/blocking` | `blocking(first:, after:, orderBy:)` |
| Blocking counts | Issue payload: `issue_dependencies_summary` | `issueDependenciesSummary` |

REST relationship lists default to 30 items and permit `per_page=100`. Parent and sub-issue reads require fine-grained **Issues: read** for private resources. Dependency reads have the same requirement. Public reads can be unauthenticated. These are supported endpoints; the current examples use `Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2026-03-10`. [REST sub-issues](https://docs.github.com/en/rest/issues/sub-issues), [REST issue dependencies](https://docs.github.com/en/rest/issues/issue-dependencies).

The three GraphQL lists are `IssueConnection`s with `nodes`, `totalCount`, and `pageInfo`. Their schema has no `states` argument, so inspect each related issue's state. Progress contains `total`, `completed`, and `percentCompleted`. Blocking summary contains `blockedBy`, `blocking`, `totalBlockedBy`, and `totalBlocking`; the `total` variants include open and closed issues. These are immediate adjacency fields, not a transitive chain endpoint. [GraphQL Issues reference](https://docs.github.com/en/graphql/reference/issues).

The official REST schema includes `sub_issues_summary.{total,completed,percent_completed}`, `issue_dependencies_summary.{blocked_by,blocking,total_blocked_by,total_blocking}`, and nullable `parent_issue_url`. Search-result items include the summaries but do not declare `parent_issue_url`. This permits skipping relationship requests for known zero totals and using the parent pointer when present. A live issue-list response omitted the pointer on an issue without a parent; handle absence as well as null. [GitHub's OpenAPI source](https://github.com/github/rest-api-description/blob/main/descriptions/api.github.com/api.github.com.json).

**Interpretation to preserve:** the repository's tracker uses `blocked_by` as the live open-blocker count. Retain both live and total counts; use total counts to decide whether historical edges exist. Do not infer the complete graph from a live count of zero. The public probes below validate open relationships, but did not exhaustively test combinations of closed source/target issues or inaccessible neighbors.

### Repository boundaries and size

- Sub-issues can cross repositories. A parent supports at most **100 immediate sub-issues**, with **eight levels** of nested sub-issues. [Adding sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues).
- Sub-issues can also cross organization boundaries; GitHub announced this in September 2025. [Sub-issue improvements](https://github.blog/changelog/2025-09-11-a-rest-api-for-github-projects-sub-issues-improvements-and-more/).
- GitHub documents **50 relationships in each blocking direction**. [Dependency release announcement](https://github.blog/changelog/2025-08-21-dependencies-on-issues/).
- Cross-repository blocking reads were confirmed in both APIs on the public relationship from [the workflow issue](https://github.com/AI-Ascension/ascension-workflow/issues/11) to [the context-console issue](https://github.com/AI-Ascension/ascension-context-console/issues/19). Both repositories belong to one organization. Cross-organization blocking and combinations of private visibility/permissions remain unverified here.

An issue's own repository identity must travel with it. A repository-scoped root query does not imply its related issues belong to that repository. **Derived approach:** deduplicate by host and node ID, retain repository/number/URL for display and lookup, and traverse newly discovered external issues separately. Neither the depth limit on sub-issues nor the per-issue blocking limit provides a useful fixed bound on the entire reachable graph. A visited set prevents repeated traversal; no undocumented acyclicity assumption is needed.

## Search capabilities and differences

The issue UI supports uppercase `AND`, `OR`, implicit AND, and parentheses nested up to five levels. Exclude a qualifier with `-`, for example `-label:bug`; use `is:issue` to exclude pull requests. [Advanced issue filters](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/filtering-and-searching-issues-and-pull-requests), [Issue search syntax](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests).

| Surface | Explicit advanced-search selection |
| --- | --- |
| REST | `GET /search/issues?q=...&advanced_search=true` |
| GraphQL | `search(query: ..., type: ISSUE_ADVANCED, first: ...)` |

Advanced search interprets adjacent `repo:`, `org:`, and `user:` qualifiers as **AND**; legacy search interprets them as **OR**. For multiple tracked repositories, use an explicit union, for example `is:issue is:open (repo:owner/one OR repo:owner/two)`. Sending the same text to legacy and advanced modes can therefore produce different results. [GitHub's advanced-search API announcement](https://github.blog/changelog/2025-07-17-duplicate-issues-create-from-anywhere-and-more/).

| Relationship filter | Meaning/evidence |
| --- | --- |
| `has:sub-issue`, `no:parent-issue` | Official examples for presence of sub-issues and absence of a parent. [Filtering announcement](https://github.blog/changelog/2024-12-12-github-issues-projects-close-issue-as-a-duplicate-rest-api-for-sub-issues-and-more/) |
| `has:parent-issue` | Official engineering article discusses this filter; live GraphQL probe also succeeded. [Sub-issue implementation](https://github.blog/engineering/architecture-optimization/introducing-sub-issues-enhancing-issue-management-on-github/) |
| `parent-issue:owner/repo#123` | Matches sub-issues of a particular parent; documented for Projects and verified here through issue search. [Parent field syntax](https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-parent-issue-and-sub-issue-progress-fields) |
| `is:blocked`, `is:blocking` | Issues blocked by others / blocking others. [Dependency announcement](https://github.blog/changelog/2025-08-21-dependencies-on-issues/) |
| `blocked-by:owner/repo#123`, `blocking:owner/repo#123` | Issues blocked by the specified issue / issues that block it; these reference forms were verified through REST. [Dependency announcement](https://github.blog/changelog/2025-08-21-dependencies-on-issues/) |

These are capability findings, not a decision to include relationship filters in Verdandi; the map currently excludes them. No generic `is:sub-issue` or `is:parent` spelling was established. Search relationships should not substitute for enumerating tree/chain edges.

### Limits

REST search returns at most **1,000 results**, up to 100 per page, searches up to 4,000 matching repositories, and can return `incomplete_results=true`. Authenticated lexical search is limited to 30 requests/minute. The reference states a 256-character limit excluding operators/qualifiers and at most five Boolean operators. Multi-resource searches can omit inaccessible resources without enumerating them in an error. Current REST also offers authenticated `search_type=semantic|hybrid` at 10 requests/minute; lexical is the default. [REST Search reference](https://docs.github.com/en/rest/search/search).

GraphQL search also caps accessible results at **1,000**, even when `issueCount` is larger. Its current enum additionally includes `ISSUE_SEMANTIC` and `ISSUE_HYBRID`. It reports `issueSearchType` and lexical fallback reasons; OR expressions are among the reasons semantic search may fall back. These modes should not be confused with deterministic advanced qualifier search. [GraphQL Search reference](https://docs.github.com/en/graphql/reference/search).

**Dated discrepancy:** a small advanced REST query containing six OR operators succeeded in the live probe. This does not establish an unlimited operator budget or replace the published limit. Until documented or systematically validated, handle rejection and partition larger searches. For complete enumeration, repository issue-list pagination avoids the search result ceiling; search alone cannot promise “all open issues.”

## Loading all open issues: requests and costs

There is no cost determined by repository count `N` alone: it also depends on issue counts, pagination, metadata selected, and the reachable external/closed graph. The following are cold-load estimates, excluding comments, attachment bodies, retries, and concurrent changes.

REST `GET /repos/{owner}/{repo}/issues?state=open&per_page=100` includes pull requests, identifiable by `pull_request`; discard those for Verdandi. Its `since` filter means updated since a time, not a deletion/change journal. [REST Issues reference](https://docs.github.com/en/rest/issues/issues).

Let `Rr` be open issues **plus open pull requests** returned in repository `r`, `I` actual open issues across tracked repositories, and `P = Σ max(1, ceil(Rr/100))`.

- **Unconditional REST:** `P + 4I` requests loads roots and, for every issue, parent, sub-issues, blocked-by, and blocking. Each direct relationship fits one 100-item page under current relationship limits.
- **Summary-gated REST:** `P + H + S + B + T`, where `H` counts distinct not-yet-loaded parent targets after deduplication, and `S/B/T` count issues with nonzero sub-issue/total-blocked-by/total-blocking counts. This assumes the expected issue payload; missing summaries require a fallback rather than interpreting absence as zero. Parent objects already loaded from root/relationship lists need no extra detail request.
- Relationship responses already contain issue objects. If `Vextra` related issues must themselves be expanded, add their unvisited relationship requests (up to four per issue), plus any missing issue-detail reads. Traversal cost grows with the graph actually explored.

**GraphQL estimate:** use `repository.issues(states:OPEN, first:100)` and request one level of all three relationship connections plus parent and summaries. GitHub estimates cost by summing connection work at declared page sizes, dividing by 100 and rounding, with a minimum of one. A repository page has `1 + 100 × 3 = 301` connection units, approximately **3 primary points**, whether that page contains 9 or 100 issues. Multiple aliased repository pages can share one HTTP request; the connection work still accumulates. Extra metadata connections increase cost. Always inspect `rateLimit.cost`. [GraphQL rate limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api).

For example, **10 repositories with 100 issues each**, no PRs, and all three relationships requested: unconditional REST is **4,010 requests**. GraphQL one repository per query is **10 HTTP requests, approximately 30 primary points**, for the roots and one adjacency level. This does **not** include recursively expanding related issues. Ten aliases might reduce HTTP calls further but enlarge payload and resource use; this is an estimate, not a benchmark or a selected design.

GraphQL connections require sizes 1–100; requests have a 500,000-node ceiling and a documented 10-second processing timeout. One hundred roots with 100 sub-issues and 50 edges in each blocking direction already requests up to 20,100 issue nodes, before metadata. Adding another full relationship level multiplies that. **Derived approach:** fetch bounded batches, then expand deduplicated discovered nodes with `nodes(ids:)` or aliases; keep every connection's cursor. Fetching the first page of each nested connection is not complete recursive pagination. [GraphQL limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api), [Cursor pagination](https://docs.github.com/en/graphql/guides/using-pagination-in-the-graphql-api).

For ordinary user authentication, REST generally allows 5,000 requests/hour; some enterprise cases allow 15,000. GraphQL generally allows 5,000 primary points/hour, with some 10,000-point enterprise cases. These are separate primary pools, shared with other activity using that identity. [REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), [GraphQL rate limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api).

Secondary limits differ: most REST reads cost one secondary point, GraphQL queries without mutations cost one regardless of primary complexity; documented ceilings include 900 REST points/minute, 2,000 GraphQL points/minute, and 100 concurrent requests across both APIs. CPU/resource limits also apply. [REST rate limits, including both APIs' secondary limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).

REST conditional requests returning authenticated `304` responses do not consume the primary quota. Respect `retry-after` and rate-reset headers, use backoff, and preserve partial/error states. A `404` may represent missing permission rather than absence. None of this determines Verdandi's refresh schedule or persistence policy. [API best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api).

## Reusing gh authentication

`gh` supports macOS Keychain, Linux Secret Service, and Windows Wincred. Modern `gh auth login` stores credentials in the system credential store, falling back to a plaintext file if storage fails. The same CLI interface hides these OS differences. [CLI keyring release notes](https://github.com/cli/cli/discussions/7109), [Current login manual](https://cli.github.com/manual/gh_auth_login).

| Option | Capability | Engineering trade-off (assessment) |
| --- | --- | --- |
| Run `gh api` | Authenticated REST/GraphQL; headers, JSON, REST pagination, GraphQL cursor pagination. | Language independent and keeps bearer-token handling in `gh`; process startup, cancellation, exit/error handling, and CLI discovery remain application concerns. |
| Capture `gh auth token --hostname github.com` | Outputs the active account's token; `--user` selects a stored account. | Then any HTTP client can reuse connections and manage requests directly; Verdandi now holds a bearer token and must keep it out of logs, command arguments, disk, and UI. |
| Use `github.com/cli/go-gh/v2` | Native Go REST/GraphQL clients following gh authentication conventions. | Convenient if Go is chosen; not a reason to choose the stack by itself, and does not remove the installed-gh prerequisite for normal keyring credentials. |

[gh api manual](https://cli.github.com/manual/gh_api), [gh auth token manual](https://cli.github.com/manual/gh_auth_token), [go-gh source/readme](https://github.com/cli/go-gh).

Specifically, `go-gh`'s `auth.TokenForHost` resolves environment/config tokens and shells out to `gh auth token` for the system keyring. `TokenFromEnvOrConfig` omits the keyring. [go-gh auth API](https://pkg.go.dev/github.com/cli/go-gh/v2/pkg/auth).

`GH_TOKEN` takes precedence over `GITHUB_TOKEN`, both overriding stored credentials for GitHub.com. Enterprise Server has separate token variables. `GH_HOST` and `GH_CONFIG_DIR` influence selection; configuration defaults differ on Windows. A GUI process may inherit a different environment/PATH from an interactive terminal: discovering the intended executable and detecting which identity is active are implementation checks on each OS, not capabilities proven by this research. [gh environment manual](https://cli.github.com/manual/gh_help_environment).

`gh api --paginate` follows one `$endCursor` workflow for GraphQL, requiring `pageInfo { hasNextPage endCursor }`. **Derived limitation:** it cannot independently schedule every cursor in a tree of many nested connections; the caller must orchestrate those. Invoke subprocesses with argument arrays, use stdin for structured requests, and handle JSON/GraphQL errors as well as exit status. [gh api manual](https://cli.github.com/manual/gh_api).

### Scopes, private repositories, and SSO

Classic/OAuth **`repo`** scope grants access to private repository resources and is broader than read-only. **`read:org`** supports reading organization/team membership. Public read access often needs no additional scope, though authentication improves quota. Scope does not grant a user permissions they do not already have. [OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps).

`gh auth login --with-token` documents `repo`, `read:org`, and `gist` as its minimum classic-token scopes; this is the CLI's expectation, not Verdandi's feature permission list. The CLI advises supplying fine-grained tokens through `GH_TOKEN` because their resource restrictions can surprise general CLI commands. For private issue/relationship reads, the endpoint permission is **Issues: read** on the selected repositories; repository discovery requires **Metadata: read**. [Login manual](https://cli.github.com/manual/gh_auth_login), [Relationship permissions](https://docs.github.com/en/rest/issues/issue-dependencies), [Repository discovery permissions](https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user).

Classic PATs need separate SAML SSO authorization; fine-grained PATs are authorized during creation. Unauthorized SSO access can yield 403/404 or partial multi-organization results with `X-GitHub-SSO`. [REST authentication](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api). OAuth application authorization also requires an active SSO session, and organizations may require app approval. Reusing `gh` does not bypass those restrictions. [OAuth app authorization](https://docs.github.com/en/apps/oauth-apps/using-oauth-apps/authorizing-oauth-apps).

## Repository and organization discovery

- `GET /user/repos?per_page=100` lists repositories with explicit access through ownership, collaboration, or organization membership. The default affiliation includes all three. Follow pagination; response metadata includes owner, visibility, and `has_issues`. This is **not all public repositories the user can read**. `GET /orgs/{org}/repos` browses repositories for a particular organization; `GET /repos/{owner}/{repo}` validates a known repository. [REST Repositories](https://docs.github.com/en/rest/repos/repos).
- `GET /user/orgs?per_page=100` lists authorized organization memberships; OAuth/classic tokens need at least `read:org` or `user`. The docs explicitly state fine-grained tokens return **200 with an empty list**. `GET /users/{user}/orgs` only returns public memberships. Organization membership is not equivalent to access to every repository. [REST Organizations](https://docs.github.com/en/rest/orgs/orgs#list-organizations-for-the-authenticated-user).
- GraphQL offers paginated `viewer.repositories` with affiliation/visibility/issue-enabled filters and `viewer.organizations`. Repository and organization owner metadata can be selected with results. [GraphQL Users](https://docs.github.com/en/graphql/reference/users).

**Possible picker ingredients:** combine explicit-access enumeration, organization browsing, repository search, and exact owner/name or URL lookup. The desired combination remains a product decision. Do not interpret an empty organization list as proof of no organization access, or an unlisted public repository as inaccessible.

## Read-only verification and remaining uncertainty

On 2026-09-26, authenticated `gh` **2.101.0** probes against GitHub.com confirmed the schema fields above. A public Verdandi issue-list query with `first:100`, parent, all three adjacent relationship connections, summaries, and page information returned nine roots at `rateLimit.cost=3`. REST probes used API version `2026-03-10`.

Advanced REST and GraphQL probes corroborated Boolean grouping, `parent-issue`, `has:sub-issue`, `is:blocked`, and `is:blocking`; GraphQL also corroborated `has:parent-issue`. REST additionally corroborated the two directional issue-reference qualifiers and explicit multi-repository OR. Adjacent repository qualifiers produced zero results in the advanced probe while explicit OR returned the expected matches. These are dated small-case observations, not a full compatibility/performance suite. No credentials, private issue data, or response snapshots are included.

The following equivalent public query reproduces the measured query shape. `rateLimit.cost` is the live authority; counts and results will change. With more than 100 roots, supply the returned root cursor as `$after` and repeat. The small related-node fragment is deliberately one level deep.

```sh
gh api graphql -f query='
query($after: String) {
  repository(owner: "chris-metz", name: "verdandi") {
    issues(states: OPEN, first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ...Identity
        parent { ...Identity }
        subIssuesSummary { total completed percentCompleted }
        issueDependenciesSummary {
          blockedBy blocking totalBlockedBy totalBlocking
        }
        subIssues(first: 100) {
          totalCount pageInfo { hasNextPage endCursor }
          nodes { ...Identity }
        }
        blockedBy(first: 100) {
          totalCount pageInfo { hasNextPage endCursor }
          nodes { ...Identity }
        }
        blocking(first: 100) {
          totalCount pageInfo { hasNextPage endCursor }
          nodes { ...Identity }
        }
      }
    }
  }
  rateLimit { cost }
}
fragment Identity on Issue {
  id number title state url repository { nameWithOwner }
}'
```

Read-only REST examples; the explicit GET matters because adding `gh api` fields otherwise switches its default method to POST:

```sh
gh api --method GET search/issues \
  -H 'X-GitHub-Api-Version: 2026-03-10' \
  -f advanced_search=true \
  -f 'q=is:issue is:open (repo:chris-metz/verdandi OR repo:cli/cli)' \
  -F per_page=100

gh api --paginate \
  'repos/chris-metz/verdandi/issues?state=open&per_page=100' \
  -H 'X-GitHub-Api-Version: 2026-03-10'
```

[gh api request-method and pagination behavior](https://cli.github.com/manual/gh_api).

Unverified cases to carry into implementation validation:

- Closed/not-planned/duplicate issues and how live counts differ from totals; visibility-sensitive counts and inaccessible related nodes.
- Cross-organization blocking, private/public combinations, fine-grained-token resource boundaries, and enterprise policy combinations.
- Exact advanced-search operator/query limits beyond the documented conservative constraints; large searches, indexing freshness, and timeout behavior.
- Whether every relationship-only change updates issue `updatedAt`/REST `updated_at` and relevant ETags; `since` alone is not established as a complete relationship-change feed.
- Packaged GUI discovery of `gh`, keyring access, account switching, environment overrides, and cancellation on macOS, Linux, and Windows.

These uncertainties do not prevent a specification from choosing an approach with explicit incomplete/error states and a validation plan. They do prevent promising a complete, instant, unbounded graph load or treating search results as a complete inventory.
