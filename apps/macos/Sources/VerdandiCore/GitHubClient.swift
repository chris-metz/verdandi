import Foundation

/// Every read of GitHub, each one request through `gh api`. Reads report the
/// budget left in their rate-limit pool to `onBudget`.
public struct GitHubClient: Sendable {
  public let gh: URL
  public let onBudget: @Sendable (RateLimitBudget) -> Void
  /// At most this many gh processes run at once.
  let limiter = Limiter(slots: 6)

  public init(gh: URL, onBudget: @escaping @Sendable (RateLimitBudget) -> Void = { _ in }) {
    self.gh = gh
    self.onBudget = onBudget
  }

  // MARK: Reads

  /// Asks gh whether its credentials for github.com work.
  public func authStatus() async throws(GitHubError) -> AuthStatus {
    let result = await runCommand(
      gh, ["auth", "status", "--json", "hosts", "--hostname", "github.com", "--active"], timeout: .seconds(30))
    guard case .exited(let code, let stdout, let stderr) = result else { throw runFailure(result) }
    guard code == 0, let json = try? JSON(parsing: stdout), let hosts = json["hosts"] else {
      throw exitFailure(code: code, stderr: stderr)
    }
    guard let entries = hosts["github.com"]?.array else { return .signedOut }
    guard let entry = entries.first(where: { $0["active"]?.bool == true }) ?? entries.first else {
      return .signedOut
    }
    let login = entry["login"]?.string
    switch entry["state"]?.string {
    case "success":
      guard let login else { throw .unexpectedResponse }
      return .signedIn(login: login)
    case "error":
      return .rejected(login: login, message: entry["error"]?.string ?? "GitHub rejected gh's credentials.")
    default:
      throw .ghFailed(entry["error"]?.string ?? "gh could not check its credentials.")
    }
  }

  /// One page of a repository's open or closed issues, newest first.
  public func issues(
    in repository: RepositoryAddress, state: IssueState, after: String? = nil
  ) async throws(GitHubError) -> IssuePage {
    let answer = try await graphql(
      """
      repository(owner: $owner, name: $name) {
        closedIssues: issues(states: CLOSED) { totalCount }
        issues(states: \(state == .open ? "OPEN" : "CLOSED"), first: 100, after: $after,
               orderBy: { field: CREATED_AT, direction: DESC }) {
          pageInfo { hasNextPage endCursor }
          nodes { \(Self.issueFields) }
        }
      }
      """,
      ["owner": ("String!", JSON(repository.owner)), "name": ("String!", JSON(repository.name)), "after": ("String", JSON(after))]
    )
    guard let repo = answer.data?["repository"], !repo.isNull,
      let connection = repo["issues"], let nodes = connection["nodes"]?.array
    else { throw answer.error(about: ["repository"]) }
    var issues: [Issue] = []
    var incomplete: GitHubError?
    for (index, node) in nodes.enumerated() {
      if let issue = Self.readIssue(node) {
        issues.append(issue)
      } else {
        incomplete = incomplete ?? answer.error(about: ["repository", "issues", "nodes", .index(index)])
      }
    }
    return IssuePage(
      issues: issues,
      closedIssueCount: repo["closedIssues"]?["totalCount"]?.int ?? 0,
      nextPage: Self.nextPage(connection),
      incomplete: incomplete ?? (answer.errors.isEmpty ? nil : answer.graphqlError(answer.errors))
    )
  }

  /// Up to 100 issues by node ID, from any repositories. Each answer is in
  /// its place, an error for one GitHub would not show.
  public func issues(ids: [String]) async throws(GitHubError) -> [Result<Issue, GitHubError>] {
    let answer = try await graphql(
      "nodes(ids: $ids) { ... on Issue { \(Self.issueFields) } }", ["ids": ("[ID!]!", JSON(ids))])
    guard let nodes = answer.data?["nodes"]?.array else { throw answer.error(about: []) }
    return ids.indices.map { index in
      if let node = nodes[safe: index], let issue = Self.readIssue(node) { return .success(issue) }
      return .failure(answer.error(about: ["nodes", .index(index)], otherwise: .unavailable("Issue unavailable or not accessible with this account.")))
    }
  }

  /// An issue with what its page shows.
  public func issueDetails(id: String) async throws(GitHubError) -> IssueDetails {
    let answer = try await graphql(
      """
      node(id: $id) { ... on Issue {
        \(Self.issueFields)
        stateReason
        assignees(first: 100) { nodes { login avatarUrl } }
        milestone { title }
        comments { totalCount }
        bodyHTML
      } }
      """,
      ["id": ("ID!", JSON(id))]
    )
    guard let node = answer.data?["node"], !node.isNull else {
      throw answer.error(about: ["node"], otherwise: .unavailable("Issue unavailable or not accessible with this account."))
    }
    guard let issue = Self.readIssue(node), let body = node["bodyHTML"]?.string else { throw .unexpectedResponse }
    return IssueDetails(
      issue: issue,
      stateReason: node["stateReason"]?.string.flatMap(StateReason.init(rawValue:)),
      assignees: (node["assignees"]?["nodes"]?.array ?? []).compactMap(Self.readActor),
      milestone: node["milestone"]?["title"]?.string,
      commentCount: node["comments"]?["totalCount"]?.int ?? 0,
      bodyHTML: body
    )
  }

  /// One page of the issues blocking an issue, or blocked by it, closed
  /// ones included.
  public func relationships(
    of issueId: String, side: BlockingSide, after: String? = nil, first: Int = 100
  ) async throws(GitHubError) -> RelationshipPage {
    let answer = try await graphql(
      """
      node(id: $id) { ... on Issue {
        \(side.rawValue)(first: $first, after: $after) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes { \(Self.issueFields) }
        }
      } }
      """,
      ["id": ("ID!", JSON(issueId)), "first": ("Int!", JSON(first)), "after": ("String", JSON(after))]
    )
    guard let connection = answer.data?["node"]?[side.rawValue], let nodes = connection["nodes"]?.array else {
      throw answer.error(about: ["node"], otherwise: .unavailable("Issue unavailable or not accessible with this account."))
    }
    var issues: [Issue] = []
    var incomplete: GitHubError?
    for (index, node) in nodes.enumerated() {
      if let issue = Self.readIssue(node) {
        issues.append(issue)
      } else {
        incomplete = incomplete ?? answer.error(about: ["node", .key(side.rawValue), "nodes", .index(index)])
      }
    }
    return RelationshipPage(
      issues: issues, totalCount: connection["totalCount"]?.int ?? issues.count,
      nextPage: Self.nextPage(connection), incomplete: incomplete)
  }

  /// One page of an issue's comments, oldest first.
  public func comments(of issueId: String, after: String? = nil) async throws(GitHubError) -> CommentPage {
    let answer = try await graphql(
      """
      node(id: $id) { ... on Issue {
        comments(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id url createdAt bodyHTML author { login avatarUrl } }
        }
      } }
      """,
      ["id": ("ID!", JSON(issueId)), "after": ("String", JSON(after))]
    )
    guard let connection = answer.data?["node"]?["comments"], let nodes = connection["nodes"]?.array else {
      throw answer.error(about: ["node"], otherwise: .unavailable("Issue unavailable or not accessible with this account."))
    }
    let comments = nodes.compactMap { node -> IssueComment? in
      guard let id = node["id"]?.string, let url = node["url"]?.string.flatMap(URL.init(string:)),
        let created = node["createdAt"]?.string.flatMap(Self.date), let body = node["bodyHTML"]?.string
      else { return nil }
      return IssueComment(id: id, url: url, createdAt: created, bodyHTML: body, author: node["author"].flatMap(Self.readActor))
    }
    return CommentPage(comments: comments, nextPage: Self.nextPage(connection))
  }

  /// What a repository numbers so, following renames: an issue, or a pull
  /// request.
  public func item(numbered number: Int, in repository: RepositoryAddress) async throws(GitHubError) -> NumberedItem {
    let answer = try await graphql(
      """
      repository(owner: $owner, name: $name) {
        issueOrPullRequest(number: $number) {
          __typename
          ... on Issue { \(Self.referenceFields) url }
          ... on PullRequest { url }
        }
      }
      """,
      ["owner": ("String!", JSON(repository.owner)), "name": ("String!", JSON(repository.name)), "number": ("Int!", JSON(number))]
    )
    guard let item = answer.data?["repository"]?["issueOrPullRequest"], !item.isNull,
      let url = item["url"]?.string.flatMap(URL.init(string:))
    else {
      throw answer.error(about: ["repository"], otherwise: .unavailable("There is no issue \(repository.reference(number))."))
    }
    if item["__typename"]?.string == "PullRequest" { return .pullRequest(url: url) }
    guard let reference = Self.readReference(item) else { throw .unexpectedResponse }
    return .issue(reference, url: url)
  }

  /// What the sidebar shows of up to 100 repositories, following renames.
  public func repositorySummaries(
    _ repositories: [RepositoryAddress]
  ) async throws(GitHubError) -> [Result<RepositorySummary, GitHubError>] {
    let (selection, variables) = Self.aliasedRepositories(
      repositories, fields: "databaseId nameWithOwner hasIssuesEnabled isArchived issues(states: OPEN) { totalCount }")
    let answer = try await graphql(selection, variables)
    return repositories.indices.map { index in
      let alias = "r\(index)"
      guard let node = answer.data?[alias], let id = node["databaseId"]?.int,
        let address = node["nameWithOwner"]?.string.flatMap(RepositoryAddress.init)
      else { return .failure(answer.error(about: [.key(alias)])) }
      return .success(
        RepositorySummary(
          id: id, repository: address, openIssueCount: node["issues"]?["totalCount"]?.int ?? 0,
          hasIssuesEnabled: node["hasIssuesEnabled"]?.bool ?? true, isArchived: node["isArchived"]?.bool ?? false))
    }
  }

  /// Whether this account can read the issues of up to 100 repositories.
  public func repositoryAccess(
    _ repositories: [RepositoryAddress]
  ) async throws(GitHubError) -> [Result<RepositoryAccess, GitHubError>] {
    let (selection, variables) = Self.aliasedRepositories(repositories, fields: Self.accessFields)
    let answer = try await graphql(selection, variables)
    return repositories.indices.map { index in
      let alias = "r\(index)"
      guard let node = answer.data?[alias], let access = Self.readAccess(node, answer: answer, path: [.key(alias)]) else {
        return .failure(answer.error(about: [.key(alias)]))
      }
      return .success(access)
    }
  }

  /// One page of the repositories this account owns, collaborates on or
  /// reaches through an organization, most recently pushed first.
  public func repositorySuggestions(after: String? = nil) async throws(GitHubError) -> SuggestionPage {
    let organizations = after == nil ? "organizations(first: 100) { nodes { login } }" : ""
    let answer = try await graphql(
      """
      me: viewer {
        login
        \(organizations)
        repositories(first: 100, after: $after,
          affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER],
          ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER],
          orderBy: {field: PUSHED_AT, direction: DESC}) {
          pageInfo { hasNextPage endCursor }
          nodes { \(Self.accessFields) }
        }
      }
      """,
      ["after": ("String", JSON(after))]
    )
    guard let me = answer.data?["me"], let login = me["login"]?.string,
      let connection = me["repositories"], let nodes = connection["nodes"]?.array
    else { throw answer.error(about: ["me"]) }
    let repositories = nodes.enumerated().compactMap { index, node in
      Self.readAccess(node, answer: answer, path: ["me", "repositories", "nodes", .index(index)])
    }
    return SuggestionPage(
      account: login,
      organizations: after == nil ? (me["organizations"]?["nodes"]?.array ?? []).compactMap { $0["login"]?.string } : nil,
      repositories: repositories,
      nextPage: Self.nextPage(connection)
    )
  }

  /// One page of up to 100 matches of an issue search, its text exactly as
  /// given, counted from 1. Pull requests are left out.
  public func searchIssues(_ query: String, page: Int) async throws(GitHubError) -> SearchPage {
    let response = try await rest(
      ["search/issues", "-f", "q=\(query)", "-f", "advanced_search=true", "-f", "per_page=100", "-f", "page=\(page)"],
      pool: .search)
    if response.status == 422 {
      let json = try? JSON(parsing: response.body)
      let message = json?["errors"]?[0]?["message"]?.string ?? json?["message"]?.string ?? "Validation Failed"
      throw .invalidSearch(message)
    }
    try response.throwIfFailed()
    guard let json = try? JSON(parsing: response.body), let items = json["items"]?.array else {
      throw .unexpectedResponse
    }
    var issues: [Issue] = []
    var pullRequests = 0
    for item in items {
      if let pr = item["pull_request"], !pr.isNull {
        pullRequests += 1
        continue
      }
      guard let issue = Self.readSearchMatch(item) else { throw .unexpectedResponse }
      issues.append(issue)
    }
    return SearchPage(
      total: json["total_count"]?.int ?? issues.count, incomplete: json["incomplete_results"]?.bool ?? false,
      issues: issues, pullRequests: pullRequests)
  }

  // MARK: Fields

  static let referenceFields = "id number title state repository { nameWithOwner }"

  static let issueFields = """
    id number title state url createdAt closedAt
    author { login avatarUrl(size: 64) }
    repository { nameWithOwner }
    labels(first: 100) { nodes { name color } }
    parent { \(referenceFields) }
    subIssuesSummary { total completed }
    issueDependenciesSummary { blockedBy blocking totalBlockedBy totalBlocking }
    subIssues(first: 100) { nodes { \(referenceFields) } }
    """

  static let accessFields = """
    databaseId nameWithOwner owner { __typename } hasIssuesEnabled isArchived
    issues(states: OPEN) { totalCount }
    """

  static func aliasedRepositories(
    _ repositories: [RepositoryAddress], fields: String
  ) -> (String, [String: (String, JSON)]) {
    var variables: [String: (String, JSON)] = [:]
    let selections = repositories.enumerated().map { index, repository in
      variables["owner\(index)"] = ("String!", JSON(repository.owner))
      variables["name\(index)"] = ("String!", JSON(repository.name))
      return "r\(index): repository(owner: $owner\(index), name: $name\(index)) { \(fields) }"
    }
    return (selections.joined(separator: "\n"), variables)
  }

  // MARK: Reading answers

  static func date(_ text: String) -> Date? {
    try? Date(text, strategy: .iso8601)
  }

  static func nextPage(_ connection: JSON) -> String? {
    connection["pageInfo"]?["hasNextPage"]?.bool == true ? connection["pageInfo"]?["endCursor"]?.string : nil
  }

  static func readActor(_ json: JSON) -> Actor? {
    guard let login = json["login"]?.string else { return nil }
    return Actor(login: login, avatarURL: json["avatarUrl"]?.string.flatMap(URL.init(string:)))
  }

  static func readReference(_ json: JSON) -> IssueReference? {
    guard let id = json["id"]?.string, let number = json["number"]?.int, let title = json["title"]?.string,
      let state = json["state"]?.string.flatMap(IssueState.init(github:)),
      let repository = json["repository"]?["nameWithOwner"]?.string.flatMap(RepositoryAddress.init)
    else { return nil }
    return IssueReference(id: id, repository: repository, number: number, title: title, state: state)
  }

  static func readLabel(_ json: JSON) -> Label? {
    guard let name = json["name"]?.string else { return nil }
    return Label(name: name, color: json["color"]?.string ?? "888888")
  }

  static func readIssue(_ json: JSON) -> Issue? {
    guard let reference = readReference(json), let url = json["url"]?.string.flatMap(URL.init(string:)),
      let created = json["createdAt"]?.string.flatMap(date)
    else { return nil }
    let parent = json["parent"].flatMap(readReference)
    let dependencies = json["issueDependenciesSummary"]
    return Issue(
      id: reference.id, repository: reference.repository, number: reference.number, title: reference.title,
      state: reference.state, url: url,
      author: json["author"].flatMap(readActor),
      createdAt: created,
      closedAt: json["closedAt"]?.string.flatMap(date),
      labels: (json["labels"]?["nodes"]?.array ?? []).compactMap(readLabel),
      parent: parent,
      subIssues: (json["subIssues"]?["nodes"]?.array ?? []).compactMap(readReference),
      hasParent: parent != nil,
      subIssuesTotal: json["subIssuesSummary"]?["total"]?.int ?? 0,
      subIssuesCompleted: json["subIssuesSummary"]?["completed"]?.int ?? 0,
      blockedBy: dependencies?["blockedBy"]?.int ?? 0,
      totalBlockedBy: dependencies?["totalBlockedBy"]?.int ?? 0,
      blocking: dependencies?["blocking"]?.int ?? 0,
      totalBlocking: dependencies?["totalBlocking"]?.int ?? 0
    )
  }

  static func readSearchMatch(_ json: JSON) -> Issue? {
    guard let id = json["node_id"]?.string, let number = json["number"]?.int, let title = json["title"]?.string,
      let state = json["state"]?.string.flatMap(IssueState.init(github:)),
      let url = json["html_url"]?.string.flatMap(URL.init(string:)),
      let created = json["created_at"]?.string.flatMap(date),
      let repository = json["repository_url"]?.string
        .map({ $0.replacingOccurrences(of: "https://api.github.com/repos/", with: "") })
        .flatMap(RepositoryAddress.init)
    else { return nil }
    let user = json["user"]
    let author = user.flatMap { user in
      user["login"]?.string.map { Actor(login: $0, avatarURL: user["avatar_url"]?.string.flatMap(URL.init(string:))) }
    }
    let dependencies = json["issue_dependencies_summary"]
    let parentURL = json["parent_issue_url"]
    return Issue(
      id: id, repository: repository, number: number, title: title, state: state, url: url,
      author: author, createdAt: created, closedAt: json["closed_at"]?.string.flatMap(date),
      labels: (json["labels"]?.array ?? []).compactMap(readLabel),
      parent: nil, subIssues: [],
      hasParent: parentURL != nil && parentURL?.isNull == false,
      subIssuesTotal: json["sub_issues_summary"]?["total"]?.int ?? 0,
      subIssuesCompleted: json["sub_issues_summary"]?["completed"]?.int ?? 0,
      blockedBy: dependencies?["blocked_by"]?.int ?? 0,
      totalBlockedBy: dependencies?["total_blocked_by"]?.int ?? 0,
      blocking: dependencies?["blocking"]?.int ?? 0,
      totalBlocking: dependencies?["total_blocking"]?.int ?? 0
    )
  }

  static func readAccess(_ json: JSON, answer: GraphQLAnswer, path: [PathElement]) -> RepositoryAccess? {
    guard let id = json["databaseId"]?.int,
      let address = json["nameWithOwner"]?.string.flatMap(RepositoryAddress.init)
    else { return nil }
    let issuesErrors = answer.errors(about: path + ["issues"])
    return RepositoryAccess(
      id: id, repository: address,
      ownedByOrganization: json["owner"]?["__typename"]?.string == "Organization",
      hasIssuesEnabled: json["hasIssuesEnabled"]?.bool ?? true,
      isArchived: json["isArchived"]?.bool ?? false,
      issuesDenied: issuesErrors.isEmpty ? nil : answer.graphqlError(issuesErrors))
  }

  // MARK: Requests

  /// Runs one GraphQL query, which also reads the budget left. Values reach
  /// GitHub as typed variables, never spliced into the query.
  func graphql(_ selection: String, _ variables: [String: (String, JSON)]) async throws(GitHubError) -> GraphQLAnswer {
    let names = variables.keys.sorted()
    let operation =
      names.isEmpty ? "query" : "query(\(names.map { "$\($0): \(variables[$0]!.0)" }.joined(separator: ", ")))"
    let query = "\(operation) { rateLimit { limit remaining resetAt } \(selection) }"
    let body = JSON.object([
      "query": .string(query),
      "variables": .object(variables.mapValues(\.1)),
    ])
    await limiter.acquire()
    let result = await runCommand(
      gh, ["api", "graphql", "--hostname", "github.com", "--include", "--input", "-"],
      input: body.serialized(), timeout: .seconds(60))
    await limiter.release()
    let response = try transcript(result)
    let json = response.status < 400 ? try? JSON(parsing: response.body) : nil
    if let rate = json?["data"]?["rateLimit"], let limit = rate["limit"]?.int, let remaining = rate["remaining"]?.int,
      let reset = rate["resetAt"]?.string.flatMap(Self.date)
    {
      onBudget(RateLimitBudget(pool: .graphql, limit: limit, remaining: remaining, resetAt: reset))
    } else if let budget = response.budget(pool: .graphql) {
      onBudget(budget)
    }
    try response.throwIfFailed()
    guard let json else { throw .unexpectedResponse }
    let answer = GraphQLAnswer(data: json["data"], errors: json["errors"]?.array ?? [], headers: response.headers)
    if answer.data == nil || answer.data?.isNull == true {
      throw answer.errors.isEmpty ? .unexpectedResponse : answer.graphqlError(answer.errors)
    }
    return answer
  }

  /// A REST GET through gh.
  func rest(_ arguments: [String], pool: RateLimitPool) async throws(GitHubError) -> HTTPResponse {
    await limiter.acquire()
    let result = await runCommand(
      gh, ["api", "--method", "GET", "--hostname", "github.com", "--include"] + arguments, timeout: .seconds(60))
    await limiter.release()
    let response = try transcript(result)
    if let budget = response.budget(pool: pool) { onBudget(budget) }
    return response
  }

  func transcript(_ result: CommandResult) throws(GitHubError) -> HTTPResponse {
    guard case .exited(let code, let stdout, let stderr) = result else { throw runFailure(result) }
    guard let response = HTTPResponse(transcript: String(decoding: stdout, as: UTF8.self)) else {
      throw exitFailure(code: code, stderr: stderr)
    }
    return response
  }

  func runFailure(_ result: CommandResult) -> GitHubError {
    switch result {
    case .notFound: .ghNotFound
    case .failedToStart(let message): .ghUnusable(message)
    case .timedOut: .ghFailed("gh did not answer in time.")
    case .exited(let code, _, let stderr): exitFailure(code: code, stderr: stderr)
    }
  }

  func exitFailure(code: Int32, stderr: String) -> GitHubError {
    let message = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
    let text = message.isEmpty ? "gh exited with code \(code)" : message
    return code == 4 ? .signedOut(text) : .ghFailed(text)
  }
}

/// An element of a path into a GraphQL answer.
public enum PathElement: Hashable, Sendable, ExpressibleByStringLiteral, ExpressibleByIntegerLiteral {
  case key(String)
  case index(Int)

  public init(stringLiteral value: String) { self = .key(value) }
  public init(integerLiteral value: Int) { self = .index(value) }

  init?(_ json: JSON) {
    if let key = json.string {
      self = .key(key)
    } else if let index = json.int {
      self = .index(index)
    } else {
      return nil
    }
  }
}

/// GitHub's answer to a GraphQL query: its data, with errors about parts it
/// left out.
struct GraphQLAnswer: Sendable {
  var data: JSON?
  var errors: [JSON]
  var headers: [String: String]

  /// The errors about `path` or anything within it.
  func errors(about path: [PathElement]) -> [JSON] {
    errors.filter { error in
      let errorPath = (error["path"]?.array ?? []).compactMap(PathElement.init)
      return errorPath.count >= path.count && Array(errorPath.prefix(path.count)) == path
    }
  }

  /// The error GitHub reported about `path`, or `otherwise`.
  func error(about path: [PathElement], otherwise: GitHubError = .unexpectedResponse) -> GitHubError {
    let about = path.isEmpty ? errors : errors(about: path)
    return about.isEmpty ? otherwise : graphqlError(about)
  }

  func graphqlError(_ errors: [JSON]) -> GitHubError {
    let messages = errors.compactMap { $0["message"]?.string }
    let type = { (error: JSON) in error["type"]?.string ?? "" }
    if let limited = errors.first(where: { type($0).hasPrefix("RATE_LIMIT") }) {
      return .rateLimited(limited["message"]?.string ?? "Rate limited.", retryAfter: headers["retry-after"].flatMap(TimeInterval.init))
    }
    if let denied = errors.first(where: { ["NOT_FOUND", "FORBIDDEN"].contains(type($0)) }) {
      return .unavailable(denied["message"]?.string ?? "Not available.")
    }
    if let timeout = messages.first(where: { $0.localizedCaseInsensitiveContains("timeout") }) {
      return .serverError(timeout)
    }
    return .graphql(messages)
  }
}

/// An HTTP response as `gh api --include` prints it.
struct HTTPResponse: Sendable {
  var status: Int
  var headers: [String: String]
  var body: String

  init?(transcript: String) {
    // Swift reads "\r\n" as one character, which `\n` would not match.
    let transcript = transcript.replacingOccurrences(of: "\r\n", with: "\n")
    guard let statusLine = transcript.firstMatch(of: /^HTTP\/[\d.]+ (\d{3})[^\n]*\n/),
      let separator = transcript.firstMatch(of: /\n\n/)
    else { return nil }
    status = Int(statusLine.1)!
    var headers: [String: String] = [:]
    for line in transcript[statusLine.range.upperBound..<separator.range.lowerBound].split(whereSeparator: \.isNewline) {
      guard let colon = line.firstIndex(of: ":") else { continue }
      headers[line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()] =
        line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
    }
    self.headers = headers
    body = String(transcript[separator.range.upperBound...])
  }

  func budget(pool: RateLimitPool) -> RateLimitBudget? {
    guard let limit = headers["x-ratelimit-limit"].flatMap(Int.init),
      let remaining = headers["x-ratelimit-remaining"].flatMap(Int.init),
      let reset = headers["x-ratelimit-reset"].flatMap(TimeInterval.init)
    else { return nil }
    let named = headers["x-ratelimit-resource"].flatMap(RateLimitPool.init(rawValue:)) ?? pool
    return RateLimitBudget(pool: named, limit: limit, remaining: remaining, resetAt: Date(timeIntervalSince1970: reset))
  }

  func throwIfFailed() throws(GitHubError) {
    guard status >= 400 else { return }
    let message = (try? JSON(parsing: body))?["message"]?.string ?? "HTTP \(status)"
    if (status == 403 || status == 429)
      && (headers["x-ratelimit-remaining"] == "0" || headers["retry-after"] != nil
        || message.localizedCaseInsensitiveContains("rate limit"))
    {
      throw .rateLimited(message, retryAfter: headers["retry-after"].flatMap(TimeInterval.init))
    }
    if [403, 404, 410].contains(status) { throw .unavailable(message) }
    if status >= 500 { throw .serverError(message) }
    throw .http(status: status, message: message)
  }
}

/// A counting semaphore for async code.
actor Limiter {
  private var free: Int
  private var waiting: [CheckedContinuation<Void, Never>] = []

  init(slots: Int) { free = slots }

  func acquire() async {
    if free > 0 {
      free -= 1
      return
    }
    await withCheckedContinuation { waiting.append($0) }
  }

  func release() {
    if waiting.isEmpty {
      free += 1
    } else {
      waiting.removeFirst().resume()
    }
  }
}

extension Array {
  subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
