import SwiftUI
import VerdandiCore

/// An issue's page as it was opened over the list: which issue, where its
/// keyboard cursor is, and how far it is scrolled. Each opening is a visit
/// of its own, starting on the issue, and keeps its cursor while it stays
/// on the path, so going back to it finds the cursor where it was.
@Observable
final class IssueVisit: Hashable {
  let issueID: String
  var cursor: PageCursor = .issue
  var scroll = ScrollPosition()
  /// The page's scroll geometry as it last scrolled, for Space to scroll by
  /// a screen. Not observed: it changes with every scroll.
  @ObservationIgnored var scrollGeometry: ScrollGeometry?

  init(issueID: String) {
    self.issueID = issueID
  }

  nonisolated static func == (a: IssueVisit, b: IssueVisit) -> Bool { a === b }

  nonisolated func hash(into hasher: inout Hasher) {
    hasher.combine(ObjectIdentifier(self))
  }
}

extension EnvironmentValues {
  /// Where the issue page's cursor shows.
  @Entry var pageCursor: PageCursor? = nil
}
