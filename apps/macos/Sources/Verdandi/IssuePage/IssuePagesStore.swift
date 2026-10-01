import Foundation
import Observation
import VerdandiCore

/// What an issue page shows, as far as it has loaded.
@Observable
final class IssuePageModel {
  let issueID: String
  var details: IssueDetails?
  var phase: LoadPhase = .idle

  init(issueID: String) {
    self.issueID = issueID
  }
}

/// The issue pages opened so far.
@Observable
final class IssuePagesStore {
  @ObservationIgnored unowned let model: AppModel
  private(set) var pages: [String: IssuePageModel] = [:]

  init(model: AppModel) {
    self.model = model
  }

  func page(for issueID: String) -> IssuePageModel {
    if let page = pages[issueID] { return page }
    let page = IssuePageModel(issueID: issueID)
    pages[issueID] = page
    return page
  }

  /// Loads a page unless it has loaded or is loading.
  func open(_ issueID: String) async {
    let page = page(for: issueID)
    if page.phase == .idle { await load(page) }
  }

  func refresh(_ issueID: String) async {
    await load(page(for: issueID))
  }

  private func load(_ page: IssuePageModel) async {
    guard let client = model.client else { return }
    page.phase = .loading
    do {
      let details = try await client.issueDetails(id: page.issueID)
      model.issues.store(details.issue)
      page.details = details
      page.phase = .loaded(.now)
    } catch {
      page.phase = .failed(error)
    }
  }
}
