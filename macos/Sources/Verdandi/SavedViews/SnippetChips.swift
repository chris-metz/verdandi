import SwiftUI
import VerdandiCore

/// A piece of search the view editor offers to add, e.g. `label:bug`.
struct QuerySnippet: Identifiable, Hashable {
  var text: String
  var help: String
  /// Snippets that cannot hold together with this one, e.g. `is:open` and
  /// `is:closed`; adding it removes them.
  var excludes: [String] = []

  var id: String { text }

  /// The snippets offered, naming the first tracked repository where one
  /// names a repository or an owner.
  static func all(tracked: [RepositoryAddress]) -> [QuerySnippet] {
    var snippets = [
      QuerySnippet(text: "is:open", help: "Open issues only", excludes: ["is:closed"]),
      QuerySnippet(text: "is:closed", help: "Closed issues only", excludes: ["is:open"]),
      QuerySnippet(text: "assignee:@me", help: "Assigned to you", excludes: ["no:assignee"]),
      QuerySnippet(text: "author:@me", help: "Opened by you"),
      QuerySnippet(text: "no:assignee", help: "Assigned to no one", excludes: ["assignee:@me"]),
      QuerySnippet(text: "label:bug", help: "Labelled bug"),
      QuerySnippet(text: "is:blocked", help: "Blocked by an open issue"),
      QuerySnippet(text: "has:sub-issue", help: "Parent issues: those with sub-issues"),
    ]
    if let first = tracked.first {
      snippets.append(QuerySnippet(text: "repo:\(first)", help: "In \(first) only"))
      snippets.append(QuerySnippet(text: "org:\(first.owner)", help: "In \(first.owner)’s repositories only"))
    }
    snippets.append(QuerySnippet(text: "sort:updated-desc", help: "Recently updated first"))
    return snippets
  }

  /// Whether the search holds this snippet as a term of its own.
  func isIn(_ query: String) -> Bool {
    Self.terms(of: query).contains { $0.lowercased() == text.lowercased() }
  }

  /// The search with this snippet removed if it holds it, otherwise added
  /// at the end, without those it excludes.
  func toggled(in query: String) -> String {
    var terms = Self.terms(of: query)
    if isIn(query) {
      terms.removeAll { $0.lowercased() == text.lowercased() }
    } else {
      let excluded = Set(excludes.map { $0.lowercased() })
      terms.removeAll { excluded.contains($0.lowercased()) }
      terms.append(text)
    }
    return terms.joined(separator: " ")
  }

  private static func terms(of query: String) -> [String] {
    query.split(whereSeparator: \.isWhitespace).map(String.init)
  }
}

/// The snippets as glass chips that add themselves to the search, or remove
/// themselves once in it.
struct SnippetChips: View {
  @Binding var query: String
  var snippets: [QuerySnippet]
  @Namespace private var glass

  var body: some View {
    GlassEffectContainer(spacing: 2) {
      SnippetFlowLayout(spacing: 8) {
        ForEach(snippets) { snippet in
          chip(snippet)
        }
      }
    }
    .padding(.vertical, 2)
  }

  private func chip(_ snippet: QuerySnippet) -> some View {
    let isOn = snippet.isIn(query)
    return Button {
      withAnimation(.snappy) { query = snippet.toggled(in: query) }
    } label: {
      HStack(spacing: 4) {
        Image(systemName: isOn ? "checkmark" : "plus")
          .font(.caption2.weight(.bold))
          .contentTransition(.symbolEffect(.replace))
        Text(snippet.text)
          .font(.callout.monospaced())
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 5)
      .foregroundStyle(isOn ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
      .glassEffect(isOn ? .regular.tint(.accentColor).interactive() : .regular.interactive(), in: .capsule)
      .glassEffectID(snippet.id, in: glass)
    }
    .buttonStyle(.plain)
    .help(snippet.help)
    .accessibilityLabel(snippet.text)
    .accessibilityHint(isOn ? "Removes it from the search" : "Adds it to the search")
    .accessibilityAddTraits(isOn ? .isSelected : [])
  }
}

/// Lays its views out in rows, left to right, wrapping when a row is full.
private struct SnippetFlowLayout: Layout {
  var spacing: CGFloat = 6

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let rows = arrange(subviews, width: proposal.width ?? .infinity)
    let width = rows.map(\.width).max() ?? 0
    let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
    return CGSize(width: proposal.width ?? width, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var y = bounds.minY
    for row in arrange(subviews, width: bounds.width) {
      var x = bounds.minX
      for index in row.indices {
        let size = subviews[index].sizeThatFits(.unspecified)
        subviews[index].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: .unspecified)
        x += size.width + spacing
      }
      y += row.height + spacing
    }
  }

  private struct Row {
    var indices: [Int] = []
    var width: CGFloat = 0
    var height: CGFloat = 0
  }

  private func arrange(_ subviews: Subviews, width: CGFloat) -> [Row] {
    var rows: [Row] = []
    var row = Row()
    for index in subviews.indices {
      let size = subviews[index].sizeThatFits(.unspecified)
      let needed = row.indices.isEmpty ? size.width : row.width + spacing + size.width
      if needed > width, !row.indices.isEmpty {
        rows.append(row)
        row = Row()
      }
      row.width = row.indices.isEmpty ? size.width : row.width + spacing + size.width
      row.height = max(row.height, size.height)
      row.indices.append(index)
    }
    if !row.indices.isEmpty { rows.append(row) }
    return rows
  }
}
