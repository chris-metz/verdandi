import SwiftUI
import VerdandiCore

/// The bar above the list, floating over it: open or closed (or a view's
/// search), the label filter's menu and refresh, and below them the label
/// filter as glass chips, each removing its label, and one clearing them
/// all. Chips morph in and out as labels come and go.
///
/// It stands in the list's column rather than the window's toolbar, which
/// spans the issue page too, so that the list's controls stay above it.
struct ListHeader: View {
  var list: IssueListModel
  @Namespace private var namespace

  var body: some View {
    GlassEffectContainer(spacing: 10) {
      VStack(alignment: .leading, spacing: 8) {
        HStack(spacing: 8) {
          if list.isView {
            SearchSummary(query: list.view?.query ?? "")
          } else {
            Picker("State", selection: Binding(get: { list.state }, set: { list.setState($0) })) {
              Text("Open").tag(IssueState.open)
              Text("Closed").tag(IssueState.closed)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
            .help("Show open or closed issues (S)")
          }
          Spacer(minLength: 0)
          LabelMenu(list: list)
            .glassEffectID("menu", in: namespace)
          RefreshButton(list: list)
        }
        if !list.labelFilter.isEmpty {
          ChipFlow(spacing: 6) {
            ForEach(list.labelFilter) { label in
              FilterChip(label: label) {
                withAnimation(.bouncy) { list.removeLabel(named: label.name) }
              }
              .glassEffectID(label.name.lowercased(), in: namespace)
            }
            Button {
              withAnimation(.bouncy) { list.clearLabelFilter() }
            } label: {
              Text("Clear")
                .font(.callout.weight(.medium))
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .contentShape(.capsule)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.interactive(), in: .capsule)
            .glassEffectID("clear", in: namespace)
            .help("Clear the label filter (Esc)")
          }
        }
      }
    }
    .padding(.horizontal, 12)
    .padding(.top, 6)
    .padding(.bottom, 8)
  }
}

/// A view's search text, which says what the view shows instead of a state.
private struct SearchSummary: View {
  var query: String

  var body: some View {
    HStack(spacing: 5) {
      Image(systemName: "magnifyingglass")
        .foregroundStyle(.secondary)
      Text(query)
        .lineLimit(1)
        .truncationMode(.tail)
    }
    .font(.callout)
    .padding(.horizontal, 10)
    .padding(.vertical, 5)
    .glassEffect(.regular, in: .capsule)
    .help(query)
    .accessibilityLabel("Search: \(query)")
  }
}

/// Reads the list again, spinning while anything is read for it.
private struct RefreshButton: View {
  var list: IssueListModel

  var body: some View {
    Button {
      Task { await list.refresh() }
    } label: {
      Image(systemName: "arrow.clockwise")
        .symbolEffect(.rotate, options: .repeat(.continuous), isActive: list.isBusy)
        .frame(width: 32, height: 32)
        .contentShape(.circle)
    }
    .buttonStyle(.plain)
    .glassEffect(.regular.interactive(), in: .circle)
    .help("Refresh (R)")
    .accessibilityLabel("Refresh")
    .disabled(list.isLoading)
  }
}

/// The labels of the list's issues, most used first, each of which adds
/// itself to the label filter or removes itself.
private struct LabelMenu: View {
  var list: IssueListModel

  var body: some View {
    Menu {
      let counts = list.labelCounts
      if counts.isEmpty {
        Text("No Labels")
      }
      ForEach(counts.prefix(40), id: \.label.name) { entry in
        Toggle(isOn: binding(entry.label)) {
          Text("\(entry.label.name)  \(Text("\(entry.count)").foregroundStyle(.secondary))")
        }
      }
      if !list.labelFilter.isEmpty {
        Divider()
        Button("Clear Label Filter") { withAnimation(.bouncy) { list.clearLabelFilter() } }
      }
    } label: {
      Image(systemName: "line.3.horizontal.decrease")
        .foregroundStyle(list.labelFilter.isEmpty ? AnyShapeStyle(.primary) : AnyShapeStyle(.tint))
    }
    .menuStyle(.button)
    .menuIndicator(.hidden)
    .buttonStyle(.plain)
    .frame(width: 32, height: 32)
    .contentShape(.circle)
    .glassEffect(.regular.interactive(), in: .circle)
    .help("Filter by label")
    .accessibilityLabel("Label Filter")
  }

  private func binding(_ label: VerdandiCore.Label) -> Binding<Bool> {
    Binding(
      get: { list.labelFilter.containsLabel(named: label.name) },
      set: { on in
        withAnimation(.bouncy) {
          if on { list.addLabel(label) } else { list.removeLabel(named: label.name) }
        }
      })
  }
}

extension IssueListModel {
  /// The labels of the issues in its scope, by how many carry each, most
  /// first.
  var labelCounts: [(label: VerdandiCore.Label, count: Int)] {
    let issues: [Issue] =
      isView ? (run?.returned ?? []) : loads.flatMap(\.ids).compactMap { lists.model.issues[$0] }
    var counts: [String: (label: VerdandiCore.Label, count: Int)] = [:]
    for label in issues.flatMap(\.labels) {
      counts[label.name.lowercased(), default: (label, 0)].count += 1
    }
    return counts.values.sorted { a, b in
      a.count != b.count ? a.count > b.count : a.label.name.localizedStandardCompare(b.label.name) == .orderedAscending
    }
  }
}

/// A label of the label filter, tinted in its colour, which removes it.
private struct FilterChip: View {
  var label: VerdandiCore.Label
  var remove: () -> Void

  var body: some View {
    let color = Color(hex: label.color)
    Button(action: remove) {
      HStack(spacing: 6) {
        Circle().fill(color).frame(width: 8, height: 8)
        Text(label.name)
          .font(.callout.weight(.medium))
          .lineLimit(1)
        Image(systemName: "xmark")
          .font(.caption2.weight(.bold))
          .foregroundStyle(.secondary)
      }
      .padding(.leading, 9)
      .padding(.trailing, 8)
      .padding(.vertical, 4)
      .contentShape(.capsule)
    }
    .buttonStyle(.plain)
    .glassEffect(.regular.tint(color.opacity(0.22)).interactive(), in: .capsule)
    .help("Remove “\(label.name)” from the label filter")
    .accessibilityLabel("Remove label \(label.name)")
  }
}

/// Lays out chips in rows, as many in each as fit.
private struct ChipFlow: Layout {
  var spacing: CGFloat

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let frames = arrange(subviews, width: proposal.width ?? .infinity)
    let width = frames.map(\.maxX).max() ?? 0
    let height = frames.map(\.maxY).max() ?? 0
    return CGSize(width: width, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    let frames = arrange(subviews, width: bounds.width)
    for (subview, frame) in zip(subviews, frames) {
      subview.place(
        at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
        proposal: ProposedViewSize(frame.size))
    }
  }

  private func arrange(_ subviews: Subviews, width: CGFloat) -> [CGRect] {
    var frames: [CGRect] = []
    var x: CGFloat = 0
    var y: CGFloat = 0
    var lineHeight: CGFloat = 0
    for subview in subviews {
      let size = subview.sizeThatFits(.unspecified)
      if x > 0 && x + size.width > width {
        x = 0
        y += lineHeight + spacing
        lineHeight = 0
      }
      frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
      x += size.width + spacing
      lineHeight = max(lineHeight, size.height)
    }
    return frames
  }
}

/// The line below the list: how far it has loaded and how current it is,
/// and what could not be read, with Retry.
struct ListStatusBar: View {
  var list: IssueListModel
  var forest: Forest

  var body: some View {
    if list.failure == nil && (list.hasLoaded || list.isLoading) {
      TimelineView(.periodic(from: .now, by: 30)) { context in
        let problems = !list.problemNotes(forest).isEmpty
        HStack(spacing: 6) {
          if list.isBusy {
            ProgressView().controlSize(.mini)
          } else if problems {
            Image(systemName: "exclamationmark.triangle.fill")
              .foregroundStyle(.orange)
              .accessibilityHidden(true)
          }
          Text(list.status(forest, now: context.date))
            .lineLimit(1)
            .truncationMode(.middle)
            .contentTransition(.numericText())
          if list.canRetry(forest) {
            Button("Retry") { Task { await list.retry() } }
              .buttonStyle(.link)
          }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity)
        .animation(.smooth, value: list.status(forest, now: context.date))
      }
    }
  }
}
