import Foundation
import Observation
import VerdandiCore

/// What the sidebar shows besides the settings: each tracked repository's
/// open-issue count, as GitHub last said.
@Observable
final class SidebarStore {
  @ObservationIgnored unowned let model: AppModel
  private(set) var summaries: [RepositoryAddress: RepositorySummary] = [:]
  private(set) var problems: [RepositoryAddress: GitHubError] = [:]

  init(model: AppModel) {
    self.model = model
  }

  /// Reads every tracked repository's summary, 100 at a time.
  func refreshSummaries() async {
    guard let client = model.client else { return }
    let addresses = model.settings.repositories.map(\.address)
    for batch in addresses.chunked(into: 100) {
      do {
        let results = try await client.repositorySummaries(batch)
        for (address, result) in zip(batch, results) {
          switch result {
          case .success(let summary):
            summaries[address] = summary
            problems[address] = nil
          case .failure(let error):
            problems[address] = error
          }
        }
      } catch {
        for address in batch { problems[address] = error }
      }
    }
  }
}
