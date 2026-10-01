import SwiftUI
import VerdandiCore

/// What shows instead of rows: placeholders while the first page loads, why
/// nothing could be read with Retry, or why there is nothing to show.
struct ListPlaceholder: View {
  @Environment(AppModel.self) private var model
  var list: IssueListModel
  var forest: Forest

  var body: some View {
    if list.isView && list.view == nil {
      ContentUnavailableView(
        "View Not Found", systemImage: "questionmark.folder",
        description: Text("This view no longer exists."))
    } else if case .all = list.item, list.repositories.isEmpty {
      ContentUnavailableView {
        SwiftUI.Label("No Tracked Repositories", systemImage: "book.closed")
      } description: {
        Text("Add repositories to see their issues here, all in one list.")
      } actions: {
        Button("Add Repositories…") { model.sheet = .repositoryPicker }
          .buttonStyle(.glassProminent)
      }
    } else if let failure = list.failure {
      ContentUnavailableView {
        switch failure {
        case .unavailable:
          SwiftUI.Label("Issues Unavailable", systemImage: "eye.slash")
        case .invalidSearch:
          SwiftUI.Label("Search Not Valid", systemImage: "magnifyingglass")
        default:
          SwiftUI.Label("Could Not Load Issues", systemImage: "exclamationmark.triangle")
        }
      } description: {
        Text(failure.message)
      } actions: {
        Button("Try Again") { Task { await list.retry() } }
          .buttonStyle(.glassProminent)
      }
    } else if list.hasLoaded && forest.trees.isEmpty && !list.isLoading {
      empty
    }
  }

  @ViewBuilder private var empty: some View {
    if !list.labelFilter.isEmpty {
      ContentUnavailableView {
        SwiftUI.Label("No Matches", systemImage: "line.3.horizontal.decrease.circle")
      } description: {
        Text("No \(list.isView ? "" : "\(list.state.rawValue) ")issues have \(labelNames).")
      } actions: {
        Button("Clear Label Filter") { withAnimation(.bouncy) { list.clearLabelFilter() } }
          .buttonStyle(.glass)
      }
    } else if list.isView {
      ContentUnavailableView(
        "No Matches", systemImage: "magnifyingglass", description: Text("The view’s search returned no issues."))
    } else {
      ContentUnavailableView {
        SwiftUI.Label(
          "No \(list.state == .open ? "Open" : "Closed") Issues",
          systemImage: list.state == .open ? "checkmark.circle" : "tray")
      } description: {
        Text(emptyDescription)
      } actions: {
        Button("Show \(list.state == .open ? "Closed" : "Open") Issues") { list.toggleState() }
          .buttonStyle(.glass)
      }
    }
  }

  private var labelNames: String {
    list.labelFilter.map(\.name).formatted(.list(type: .and))
  }

  private var emptyDescription: String {
    switch list.item {
    case .repository(let address): "\(address) has no \(list.state.rawValue) issues."
    default: "None of the tracked repositories has \(list.state.rawValue) issues."
    }
  }
}

/// Rows in the shape of issues, gently pulsing, while the first page loads.
struct SkeletonRows: View {
  /// Each row's title and second line, as fractions of their widths.
  private static let shapes: [(title: CGFloat, labels: Int)] = [
    (0.92, 1), (0.7, 2), (0.84, 0), (0.6, 1), (0.88, 2), (0.66, 0), (0.78, 1), (0.95, 1), (0.58, 2), (0.8, 0),
    (0.72, 1), (0.86, 2), (0.64, 0), (0.9, 1),
  ]

  var body: some View {
    ForEach(Self.shapes.indices, id: \.self) { index in
      SkeletonRow(title: Self.shapes[index].title, labels: Self.shapes[index].labels)
        .selectionDisabled()
    }
    .phaseAnimator([false, true]) { content, dim in
      content.opacity(dim ? 0.45 : 1)
    } animation: { _ in
      .easeInOut(duration: 1.1)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Loading issues")
  }
}

private struct SkeletonRow: View {
  var title: CGFloat
  var labels: Int

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 6) {
        Circle().frame(width: 13, height: 13)
        GeometryReader { space in
          Capsule().frame(width: space.size.width * title, height: 9)
            .frame(maxHeight: .infinity)
        }
        .frame(height: 13)
        Capsule().frame(width: 18, height: 8)
        Circle().frame(width: 16, height: 16)
      }
      HStack(spacing: 5) {
        Capsule().frame(width: 34, height: 7)
        ForEach(0..<labels, id: \.self) { index in
          Capsule().frame(width: index == 0 ? 52 : 40, height: 11)
        }
      }
      .padding(.leading, 19)
    }
    .foregroundStyle(.quinary)
    .padding(.vertical, 5)
  }
}
