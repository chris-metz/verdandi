import AppKit
import Foundation
import Observation
import VerdandiCore

/// How far one part of an issue page has loaded.
enum PagePartPhase: Equatable {
  case idle
  case loading
  case loaded(Date)
  case failed(GitHubError)

  var isLoading: Bool { self == .loading }

  var error: GitHubError? {
    if case .failed(let error) = self { return error }
    return nil
  }
}

/// What an issue page shows, as far as it has loaded. Its parts load on
/// their own, so the page shows at once from the issue the list read, and
/// fills in as its details, comments, ancestry and blocking map arrive.
@Observable
final class IssuePageModel {
  let issueID: String

  /// The issue with what only its page shows: body, assignees, milestone.
  var details: IssueDetails?
  var detailsPhase: PagePartPhase = .idle

  /// Its comments, oldest first; the first time, as their pages arrive.
  var comments: [IssueComment] = []
  var commentsPhase: PagePartPhase = .idle

  var ancestryPhase: PagePartPhase = .idle

  /// The blocking relationships the map has read, of this issue and of
  /// those around it.
  var blockingLists: [BlockingListKey: BlockingList] = [:]
  /// Why some of them could not be read.
  var blockingFailures: [BlockingListKey: GitHubError] = [:]
  var mapPhase: PagePartPhase = .idle
  /// How many steps out the map reaches on each side.
  var mapSteps: [BlockingSide: Int] = [.blockedBy: 2, .blocking: 2]
  /// The steps whose columns show all their cards.
  var expandedColumns: Set<Int> = []

  /// The measured heights of bodies, by the ID of their issue or comment,
  /// so a body shown again takes its place at once.
  @ObservationIgnored var bodyHeights: [String: CGFloat] = [:]

  init(issueID: String) {
    self.issueID = issueID
  }

  /// Whether any part of it is being read.
  var isLoading: Bool {
    detailsPhase.isLoading || commentsPhase.isLoading || ancestryPhase.isLoading || mapPhase.isLoading
  }

  /// When its details were last read.
  var loadedAt: Date? {
    if case .loaded(let date) = detailsPhase { return date }
    return nil
  }
}

/// The issue pages opened so far.
@Observable
final class IssuePagesStore {
  @ObservationIgnored unowned let model: AppModel
  /// Made as views ask for them, so not observed: each page is.
  @ObservationIgnored private(set) var pages: [String: IssuePageModel] = [:]

  /// A page older than this is read again when it shows.
  static let freshness: TimeInterval = 5 * 60
  /// The cards a step of the map reads relationships of, at most, per side.
  static let listsPerStep = 30
  /// Whether the map follows chains past closed issues: they block nothing
  /// any more, but show how the work went.
  static let followsClosedIssues = true

  init(model: AppModel) {
    self.model = model
  }

  func page(for issueID: String) -> IssuePageModel {
    if let page = pages[issueID] { return page }
    let page = IssuePageModel(issueID: issueID)
    pages[issueID] = page
    return page
  }

  // MARK: Loading

  /// Loads a page unless it has loaded or is loading; reads it again if it
  /// has grown old, or if it could not be read the last time.
  func open(_ issueID: String) async {
    let page = page(for: issueID)
    guard !page.isLoading else { return }
    if page.detailsPhase == .idle {
      await load(page, again: false)
    } else if page.detailsPhase.error != nil {
      await load(page, again: true)
    } else if let loadedAt = page.loadedAt, Date.now.timeIntervalSince(loadedAt) > Self.freshness {
      await load(page, again: true)
    }
  }

  /// Reads everything the page shows again, showing what it has meanwhile.
  func refresh(_ issueID: String) async {
    let page = page(for: issueID)
    guard !page.isLoading else { return }
    await load(page, again: true)
  }

  private func load(_ page: IssuePageModel, again: Bool) async {
    guard let client = model.client else { return }
    async let details: Void = loadDetails(page, client: client, again: again)
    async let comments: Void = loadComments(page, client: client)
    async let map: Void = loadMap(page, client: client, again: again)
    _ = await (details, comments, map)
  }

  private func loadDetails(_ page: IssuePageModel, client: GitHubClient, again: Bool) async {
    page.detailsPhase = .loading
    do {
      let details = try await client.issueDetails(id: page.issueID)
      model.issues.store(details.issue)
      page.details = details
      page.detailsPhase = .loaded(.now)
    } catch {
      page.detailsPhase = .failed(error)
      return
    }
    // The list's copy of the issue may have said it had no map.
    if let issue = page.details?.issue, issue.hasBlockingRelationships,
      page.blockingLists.isEmpty, !page.mapPhase.isLoading
    {
      async let map: Void = loadMap(page, client: client, again: false)
      await loadAncestry(page, client: client, again: again)
      await map
    } else {
      await loadAncestry(page, client: client, again: again)
    }
  }

  /// Reads the issue's parent issue, its parent, and so on up to the top,
  /// those not read yet, or all of them again.
  private func loadAncestry(_ page: IssuePageModel, client: GitHubClient, again: Bool) async {
    page.ancestryPhase = .loading
    if again {
      let known = ancestry(of: page.issueID).map(\.id)
      if !known.isEmpty { await model.issues.fetch(known, with: client, again: true) }
    }
    // Each read reveals the next parent up, until one has none or cannot
    // be read.
    var tried: Set<String> = []
    while let unread = ancestry(of: page.issueID).first(where: { model.issues[$0.id] == nil }),
      tried.insert(unread.id).inserted
    {
      await model.issues.fetch([unread.id], with: client)
    }
    let failure = ancestry(of: page.issueID).lazy.compactMap { self.model.issues.failures[$0.id] }.first
    page.ancestryPhase = failure.map { .failed($0) } ?? .loaded(.now)
  }

  private func loadComments(_ page: IssuePageModel, client: GitHubClient) async {
    let firstRead = page.commentsPhase == .idle || page.comments.isEmpty
    page.commentsPhase = .loading
    var comments: [IssueComment] = []
    var after: String?
    do {
      repeat {
        let next = try await client.comments(of: page.issueID, after: after)
        comments += next.comments
        after = next.nextPage
        if firstRead { page.comments = comments }
      } while after != nil
      page.comments = comments
      page.commentsPhase = .loaded(.now)
    } catch {
      page.commentsPhase = .failed(error)
    }
  }

  // MARK: Blocking map

  private func loadMap(_ page: IssuePageModel, client: GitHubClient, again: Bool) async {
    let issue = model.issues[page.issueID]
    // An issue known to have no blocking relationships needs no map.
    if let issue, !issue.hasBlockingRelationships, !again {
      page.mapPhase = .loaded(.now)
      return
    }
    page.mapPhase = .loading
    if again { page.blockingFailures = [:] }
    async let blockers: Void = loadSide(.blockedBy, of: page, client: client, again: again)
    async let blocked: Void = loadSide(.blocking, of: page, client: client, again: again)
    _ = await (blockers, blocked)
    page.mapPhase = page.blockingFailures.values.first.map { .failed($0) } ?? .loaded(.now)
  }

  /// Reads the map further out on one side, two steps more.
  func extendMap(_ page: IssuePageModel, side: BlockingSide) async {
    guard let client = model.client, !page.mapPhase.isLoading else { return }
    page.mapSteps[side, default: 2] += 2
    page.mapPhase = .loading
    await loadSide(side, of: page, client: client, again: false)
    page.mapPhase = page.blockingFailures.values.first.map { .failed($0) } ?? .loaded(.now)
  }

  /// Reads one side of the map a step at a time: all of the issue's own
  /// relationships, then the first page of those of each issue on the
  /// steps before the last, so the last step's cards know how many lie
  /// beyond.
  private func loadSide(_ side: BlockingSide, of page: IssuePageModel, client: GitHubClient, again: Bool) async {
    let root = page.issueID
    var frontier = [root]
    var seen: Set<String> = [root]
    for step in 0..<(page.mapSteps[side] ?? 2) {
      let wanted = frontier.filter { id in
        let key = BlockingListKey(id, side)
        guard again || page.blockingLists[key] == nil else { return false }
        if id == root { return true }
        guard let issue = model.issues[id] else { return false }
        return (Self.followsClosedIssues || issue.state == .open) && issue.blockingTotal(side) > 0
      }
      .prefix(Self.listsPerStep)
      if step == 0, !wanted.isEmpty {
        await readAllPages(of: root, side: side, page: page, client: client)
      } else if !wanted.isEmpty {
        let results = await Self.readFirstPages(of: Array(wanted), side: side, client: client)
        for (id, result) in results { store(result, as: BlockingListKey(id, side), in: page) }
      }
      frontier = frontier.flatMap { page.blockingLists[BlockingListKey($0, side)]?.ids ?? [] }
        .filter { seen.insert($0).inserted }
      if frontier.isEmpty { break }
    }
  }

  /// Reads every page of the map's own issue's relationships on a side.
  private func readAllPages(of id: String, side: BlockingSide, page: IssuePageModel, client: GitHubClient) async {
    let key = BlockingListKey(id, side)
    var ids: [String] = []
    var after: String?
    do {
      // Ten pages are a thousand issues, more than a map can show.
      for _ in 0..<10 {
        let next = try await client.relationships(of: id, side: side, after: after)
        model.issues.store(next.issues)
        ids += next.issues.map(\.id)
        page.blockingLists[key] = BlockingList(ids: ids, totalCount: next.totalCount)
        page.blockingFailures[key] = nil
        after = next.nextPage
        if after == nil { break }
      }
    } catch {
      page.blockingFailures[key] = error
    }
  }

  private func store(_ result: Result<RelationshipPage, GitHubError>, as key: BlockingListKey, in page: IssuePageModel) {
    switch result {
    case .success(let read):
      model.issues.store(read.issues)
      page.blockingLists[key] = BlockingList(ids: read.issues.map(\.id), totalCount: read.totalCount)
      page.blockingFailures[key] = nil
    case .failure(let error):
      page.blockingFailures[key] = error
    }
  }

  /// Reads the first page of several issues' relationships on a side at
  /// once; the client limits how many run together.
  nonisolated private static func readFirstPages(
    of ids: [String], side: BlockingSide, client: GitHubClient
  ) async -> [(String, Result<RelationshipPage, GitHubError>)] {
    await withTaskGroup(of: (String, Result<RelationshipPage, GitHubError>).self) { group in
      for id in ids {
        group.addTask {
          do throws(GitHubError) {
            return (id, .success(try await client.relationships(of: id, side: side, first: 50)))
          } catch {
            return (id, .failure(error))
          }
        }
      }
      var results: [(String, Result<RelationshipPage, GitHubError>)] = []
      for await result in group { results.append(result) }
      return results
    }
  }

  /// The map of a page, from what has been read.
  func map(of page: IssuePageModel) -> BlockingMap {
    BlockingMap(
      root: page.issueID, steps: page.mapSteps, followsClosed: Self.followsClosedIssues,
      issue: { self.model.issues[$0] },
      list: { page.blockingLists[$0] })
  }

  /// The map of a page as it shows: in columns of at most six cards, but
  /// those the user expanded.
  func mapLayout(of page: IssuePageModel) -> BlockingMapLayout {
    BlockingMapLayout(map(of: page), cardsPerColumn: 6, expanded: page.expandedColumns)
  }

  // MARK: Ancestry

  /// The issue's parent issue, its parent and so on, top first, as far as
  /// they have been read: a parent not read yet ends it.
  func ancestry(of issueID: String) -> [IssueReference] {
    var chain: [IssueReference] = []
    var next = model.issues[issueID]?.parent
    while let parent = next, !chain.contains(where: { $0.id == parent.id }), parent.id != issueID {
      chain.append(model.issues[parent.id]?.reference ?? parent)
      next = model.issues[parent.id]?.parent
    }
    return chain.reversed()
  }

  // MARK: Navigation

  /// What a page's cursor can be on, as the page shows them: its parent
  /// issues, the issue with its blocking map if it has one, and its
  /// sub-issues.
  func targets(of page: IssuePageModel) -> PageTargets {
    let issue = model.issues[page.issueID] ?? page.details?.issue
    return PageTargets(
      issueID: page.issueID, parents: ancestry(of: page.issueID).map(\.id),
      map: issue?.hasBlockingRelationships == true ? mapLayout(of: page) : nil,
      subIssues: issue?.subIssues.map(\.id) ?? [])
  }

  /// Where GitHub shows an issue on a page, also a parent issue or
  /// sub-issue known only by reference.
  func webURL(of id: String, on page: IssuePageModel) -> URL? {
    if let issue = model.issues[id] { return issue.url }
    let subIssues = (model.issues[page.issueID] ?? page.details?.issue)?.subIssues ?? []
    return (ancestry(of: page.issueID) + subIssues).first { $0.id == id }?.webURL
  }

  /// Opens an issue's page over the one showing.
  func show(_ issueID: String) {
    model.openIssue(issueID)
  }

  /// Follows a link in a body or comment: one to an issue opens it here,
  /// one to a pull request or anything else on the web in the browser.
  func follow(_ url: URL) {
    guard let link = IssueLink(url) else {
      if ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") { NSWorkspace.shared.open(url) }
      return
    }
    if let known = model.issues.issues.values.first(where: { $0.repository == link.repository && $0.number == link.number }) {
      show(known.id)
      return
    }
    guard let client = model.client else {
      NSWorkspace.shared.open(url)
      return
    }
    Task {
      do {
        switch try await client.item(numbered: link.number, in: link.repository) {
        case .issue(let reference, _): show(reference.id)
        case .pullRequest(let url): NSWorkspace.shared.open(url)
        }
      } catch {
        NSWorkspace.shared.open(url)
      }
    }
  }
}
