import AppKit
import SwiftUI
import VerdandiCore

/// The issue's blocking map: a band as wide as the page that scrolls
/// sideways, with the issues that block it to the left, those it blocks to
/// the right, a column per step, and arrows from each blocker to what it
/// blocks. Clicking a card opens its issue; the arrow keys or h, j, k, l
/// move between cards once the map has focus, Return opens one and o opens
/// it on GitHub.
struct BlockingMapBand: View {
  @Environment(AppModel.self) private var model
  var page: IssuePageModel
  var issue: Issue

  @FocusState private var focused: Bool
  @State private var hovered: BlockingNode?
  @State private var viewport: CGFloat = 0
  @State private var contentWidth: CGFloat = 0
  /// Whether the map has been moved on from its issue, which it keeps in
  /// the middle as it grows until then.
  @State private var moved = false
  /// Whether the cursor shows without focus, for a launch option.
  @State private var showsCursor = false

  var body: some View {
    let map = model.pages.map(of: page)
    let layout = BlockingMapLayout(map, cardsPerColumn: 6, expanded: page.expandedColumns)
    let cursor = layout.contains(page.mapCursor) ? page.mapCursor : .issue(page.issueID)
    VStack(alignment: .leading, spacing: 4) {
      header(hasCycle: layout.edges.contains { $0.cycle })
        .issuePageColumn()
      ScrollViewReader { proxy in
        ScrollView(.horizontal) {
          BlockingMapCanvas(
            layout: layout,
            cardWidth: MapMetrics.cardWidth(fitting: viewport),
            root: page.issueID,
            rootRepository: issue.repository,
            cursor: focused || showsCursor ? cursor : nil,
            highlighted: hovered ?? (focused || showsCursor ? cursor : nil),
            onHover: { hovered = $0 },
            onActivate: { node in
              page.mapCursor = node
              activate(node)
            }
          )
          .padding(.horizontal, IssuePageMetrics.margin)
          .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { contentWidth = $0 }
          .frame(minWidth: viewport)
          .contentShape(Rectangle())
          .focusable(interactions: .edit)
          .focused($focused)
          .focusEffectDisabled()
          .onKeyPress(phases: .down) { press in handle(press, layout: layout, cursor: cursor) }
          .simultaneousGesture(TapGesture().onEnded { focused = true })
        }
        .scrollIndicators(contentWidth > viewport + 1 ? .automatic : .never)
        .scrollDisabled(contentWidth <= viewport + 1)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { viewport = $0 }
        .onChange(of: page.mapCursor) { _, node in
          moved = true
          withAnimation(.smooth) { proxy.scrollTo(node) }
        }
        .onChange(of: layout.columns.map(\.step), initial: true) {
          guard !moved else { return }
          proxy.scrollTo(BlockingNode.issue(page.issueID), anchor: .center)
        }
      }
    }
    .padding(.vertical, 16)
    .background {
      Rectangle()
        .fill(.fill.quinary)
        .overlay(alignment: .top) { Divider() }
        .overlay(alignment: .bottom) { Divider() }
    }
    .task {
      // A launch option, to look at the map's cursor without clicking.
      guard LaunchOptions.environment["VERDANDI_FOCUS"] == "map" else { return }
      try? await Task.sleep(for: .seconds(2))
      focused = true
      // A window that is not key takes no focus; show the cursor anyway.
      showsCursor = true
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Blocking map")
  }

  private func header(hasCycle: Bool) -> some View {
    HStack(spacing: 8) {
      IssuePageSectionTitle("Blocking", systemImage: "point.3.connected.trianglepath.dotted")
      if page.mapPhase.isLoading {
        ProgressView().controlSize(.mini)
      }
      if hasCycle {
        Label("Cycle", systemImage: "arrow.trianglehead.2.clockwise")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.orange)
          .padding(.horizontal, 7)
          .padding(.vertical, 2)
          .background(.orange.opacity(0.14), in: Capsule())
          .help("Some of these issues block each other in a circle: the dotted arrows")
      }
      Spacer()
      if !page.blockingFailures.isEmpty, !page.mapPhase.isLoading {
        Label("Some relationships could not be loaded", systemImage: "exclamationmark.triangle")
          .font(.caption)
          .foregroundStyle(.secondary)
          .help(page.blockingFailures.values.first?.message ?? "")
        Button("Retry") { Task { await model.pages.refresh(page.issueID) } }
          .controlSize(.small)
      }
    }
  }

  private func activate(_ node: BlockingNode) {
    switch node {
    case .issue(let id):
      if id != page.issueID { model.pages.show(id) }
    case .more(let step):
      withAnimation(.smooth) { _ = page.expandedColumns.insert(step) }
    case .further(let side):
      Task { await model.pages.extendMap(page, side: side) }
    }
  }

  private func handle(_ press: KeyPress, layout: BlockingMapLayout, cursor: BlockingNode) -> KeyPress.Result {
    guard press.modifiers.isDisjoint(with: [.command, .option, .control, .shift]) else { return .ignored }
    let direction: MapDirection? =
      switch press.key {
      case .leftArrow: .left
      case .rightArrow: .right
      case .upArrow: .up
      case .downArrow: .down
      default:
        switch press.characters {
        case "h": .left
        case "l": .right
        case "k": .up
        case "j": .down
        default: nil
        }
      }
    if let direction {
      if let next = layout.neighbour(of: cursor, toward: direction) { page.mapCursor = next }
      return .handled
    }
    if press.key == .return {
      activate(cursor)
      return .handled
    }
    if press.characters == "o", case .issue(let id) = cursor, let url = model.issues[id]?.url {
      NSWorkspace.shared.open(url)
      return .handled
    }
    return .ignored
  }
}

/// How the map's cards are sized and spaced.
private enum MapMetrics {
  static let columnGap: CGFloat = 56

  /// As wide as lets the issue and its neighbours on both sides show in
  /// `viewport`, within what a card reads well at.
  static func cardWidth(fitting viewport: CGFloat) -> CGFloat {
    let fitting = (viewport - 2 * IssuePageMetrics.margin - 2 * columnGap) / 3
    return min(216, max(176, fitting.rounded(.down)))
  }
  static let rowGap: CGFloat = 14
  /// Room above and below the cards for arrows that go around them.
  static let lane: CGFloat = 26
  static let cornerRadius: CGFloat = 12
}

/// The map's columns, headers above, with the arrows drawn behind the
/// cards from where the cards turned out to be.
private struct BlockingMapCanvas: View {
  var layout: BlockingMapLayout
  var cardWidth: CGFloat
  var root: String
  var rootRepository: RepositoryAddress
  /// The node the keyboard is on, while the map has focus.
  var cursor: BlockingNode?
  /// The node whose arrows stand out.
  var highlighted: BlockingNode?
  var onHover: (BlockingNode?) -> Void
  var onActivate: (BlockingNode) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top, spacing: MapMetrics.columnGap) {
        ForEach(layout.columns) { column in
          Text(column.title)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(column.step == 0 ? .primary : .secondary)
            .frame(width: cardWidth, alignment: .leading)
        }
      }
      .padding(.top, 10)
      HStack(alignment: .center, spacing: MapMetrics.columnGap) {
        ForEach(layout.columns) { column in
          VStack(spacing: MapMetrics.rowGap) {
            ForEach(column.nodes) { node in
              nodeView(node, step: column.step)
                .id(node.id)
                .anchorPreference(key: MapNodeAnchors.self, value: .bounds) { [node.id: $0] }
                .onHover { onHover($0 ? node.id : nil) }
            }
          }
          .frame(width: cardWidth)
        }
      }
      .padding(.vertical, MapMetrics.lane)
      .backgroundPreferenceValue(MapNodeAnchors.self) { anchors in
        GeometryReader { proxy in
          MapArrows(edges: layout.edges, frames: anchors.mapValues { proxy[$0] }, highlighted: highlighted)
        }
      }
    }
    .animation(.smooth, value: layout)
  }

  @ViewBuilder
  private func nodeView(_ node: BlockingMapLayout.Node, step: Int) -> some View {
    let hasCursor = cursor == node.id
    switch node {
    case .card(let card):
      Button { onActivate(node.id) } label: {
        MapCardView(
          card: card, width: cardWidth, isRoot: card.id == root, outward: step < 0 ? .blockedBy : step > 0 ? .blocking : nil,
          showsRepository: card.issue.repository != rootRepository, hasCursor: hasCursor,
          isHighlighted: highlighted == node.id)
      }
      .buttonStyle(.plain)
      .contextMenu { MapCardMenu(issue: card.issue) }
      .accessibilityLabel("\(card.issue.qualifiedReference): \(card.issue.title), \(card.issue.state == .open ? "open" : "closed")")
      .help(card.issue.title)
    case .more(_, let count):
      Button { onActivate(node.id) } label: {
        MapPlaceholderView(
          width: cardWidth, title: "+\(count) more", subtitle: nil, systemImage: "chevron.down", hasCursor: hasCursor)
      }
      .buttonStyle(.plain)
      .help("Show every issue of this column")
    case .further(let side, let further):
      Button { onActivate(node.id) } label: {
        MapPlaceholderView(
          width: cardWidth, title: further.isExact ? "+\(further.folded) more" : "More…",
          subtitle: "Show 2 more steps",
          systemImage: side == .blockedBy ? "chevron.backward.2" : "chevron.forward.2", hasCursor: hasCursor)
      }
      .buttonStyle(.plain)
      .help(side == .blockedBy ? "Read the blocking chain further back" : "Read the blocking chain further on")
    }
  }
}

/// An issue on the map.
private struct MapCardView: View {
  var card: BlockingMap.Card
  var width: CGFloat
  var isRoot: Bool
  /// The side its relationships lead away from the map's issue, unless it
  /// is the map's issue.
  var outward: BlockingSide?
  var showsRepository: Bool
  var hasCursor: Bool
  var isHighlighted: Bool

  var body: some View {
    let issue = card.issue
    let shape = RoundedRectangle(cornerRadius: MapMetrics.cornerRadius, style: .continuous)
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 5) {
        IssueStateIcon(state: issue.state)
          .imageScale(.small)
        Text(showsRepository ? issue.qualifiedReference : "#\(issue.number)")
          .font(.caption.monospacedDigit())
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .truncationMode(.head)
        Spacer(minLength: 4)
        if !isRoot, issue.state == .open, issue.blockedBy > 0 {
          Circle()
            .fill(.orange)
            .frame(width: 7, height: 7)
            .help("Blocked by \(issue.blockedBy) open \(issue.blockedBy == 1 ? "issue" : "issues")")
            .accessibilityLabel("Blocked")
        }
      }
      Text(issue.title)
        .font(isRoot ? .callout.weight(.semibold) : .callout)
        .foregroundStyle(issue.state == .closed && !isRoot ? .secondary : .primary)
        .lineLimit(3)
        .multilineTextAlignment(.leading)
        .frame(maxWidth: .infinity, alignment: .leading)
      if !issue.labels.isEmpty {
        HStack(spacing: 3) {
          ForEach(issue.labels.prefix(8)) { label in
            Circle()
              .fill(Color(hex: label.color))
              .frame(width: 7, height: 7)
              .help(label.name)
          }
        }
        .padding(.top, 1)
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
    .frame(width: width, alignment: .leading)
    .background {
      shape.fill(Color(nsColor: .controlBackgroundColor))
      if isRoot { shape.fill(Color.accentColor.opacity(0.08)) }
    }
    .overlay {
      shape.strokeBorder(
        isRoot ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.separator),
        lineWidth: isRoot ? 2 : 1)
    }
    .shadow(color: .black.opacity(isHighlighted ? 0.14 : 0.06), radius: isHighlighted ? 8 : 2, y: isHighlighted ? 3 : 1)
    .overlay {
      if hasCursor {
        RoundedRectangle(cornerRadius: MapMetrics.cornerRadius + 4, style: .continuous)
          .strokeBorder(Color.accentColor, lineWidth: 3)
          .padding(-5)
      }
    }
    .overlay(alignment: outward == .blockedBy ? .topLeading : .topTrailing) {
      if let outward { badge(outward) }
    }
    .contentShape(shape)
    .scaleEffect(isHighlighted ? 1.015 : 1)
    .animation(.smooth(duration: 0.18), value: isHighlighted)
  }

  /// What leads further out from it that the map does not show.
  @ViewBuilder
  private func badge(_ side: BlockingSide) -> some View {
    let offset = CGSize(width: side == .blockedBy ? -8 : 8, height: -8)
    if card.unread > 0 {
      Text(verbatim: "+\(card.unread)")
        .font(.caption2.weight(.semibold).monospacedDigit())
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(Capsule().fill(Color(nsColor: .controlBackgroundColor)))
        .overlay(Capsule().strokeBorder(.separator))
        .foregroundStyle(.secondary)
        .offset(offset)
        .help(
          "\(card.unread) more \(side == .blockedBy ? "blockers" : "blocked issues") not shown")
    } else if card.notFollowed {
      Image(systemName: "ellipsis")
        .font(.caption2.weight(.bold))
        .frame(width: 18, height: 14)
        .background(Capsule().fill(Color(nsColor: .controlBackgroundColor)))
        .overlay(Capsule().strokeBorder(.separator))
        .foregroundStyle(.tertiary)
        .offset(offset)
        .help("Closed, so what lies beyond it is not followed")
    }
  }
}

/// A node standing for cards the map does not show: a control on glass,
/// which shows them.
private struct MapPlaceholderView: View {
  var width: CGFloat
  var title: String
  var subtitle: String?
  var systemImage: String
  var hasCursor: Bool

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: MapMetrics.cornerRadius, style: .continuous)
    HStack(spacing: 8) {
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.callout.weight(.medium))
        if let subtitle {
          Text(subtitle).font(.caption).foregroundStyle(.secondary)
        }
      }
      Spacer(minLength: 0)
      Image(systemName: systemImage)
        .fontWeight(.semibold)
        .foregroundStyle(.secondary)
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 10)
    .frame(width: width, alignment: .leading)
    .contentShape(shape)
    .glassEffect(.regular.interactive(), in: shape)
    .overlay {
      if hasCursor {
        RoundedRectangle(cornerRadius: MapMetrics.cornerRadius + 4, style: .continuous)
          .strokeBorder(Color.accentColor, lineWidth: 3)
          .padding(-5)
      }
    }
  }
}

/// What a card's context menu offers.
private struct MapCardMenu: View {
  var issue: Issue

  var body: some View {
    Button("Open on GitHub", systemImage: "safari") { NSWorkspace.shared.open(issue.url) }
    Divider()
    Button("Copy Link", systemImage: "link") { copy(issue.url.absoluteString) }
    Button("Copy Reference", systemImage: "number") { copy(issue.qualifiedReference) }
  }

  private func copy(_ text: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
  }
}

/// Where each node of the map is, for the arrows.
private nonisolated struct MapNodeAnchors: PreferenceKey {
  static var defaultValue: [BlockingNode: Anchor<CGRect>] { [:] }

  static func reduce(value: inout [BlockingNode: Anchor<CGRect>], nextValue: () -> [BlockingNode: Anchor<CGRect>]) {
    value.merge(nextValue()) { $1 }
  }
}

/// The map's arrows, each from a blocker's right edge to the left edge of
/// what it blocks: a curve between neighbouring columns, a detour over the
/// cards when one stands in the way or when it closes a cycle back to the
/// left. Arrows leaving or reaching the same card spread along its edge in
/// the order of their other ends, so they do not cross there. Arrows past
/// a closed issue are dashed, cycles dotted and orange.
private struct MapArrows: View {
  var edges: [BlockingMap.Edge]
  var frames: [BlockingNode: CGRect]
  var highlighted: BlockingNode?

  var body: some View {
    Canvas { context, _ in
      let ports = ports()
      let drawn = edges.indices.filter { ports[$0] != nil }
      let lit = drawn.filter { edges[$0].from == highlighted || edges[$0].to == highlighted }
      for index in drawn where !lit.contains(index) {
        draw(edges[index], ports: ports[index], lit: false, in: &context)
      }
      for index in lit { draw(edges[index], ports: ports[index], lit: true, in: &context) }
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }

  /// Where each edge leaves its blocker and reaches what it blocks.
  private func ports() -> [Int: (start: CGPoint, end: CGPoint)] {
    let drawn = edges.indices.filter { frames[edges[$0].from] != nil && frames[edges[$0].to] != nil }
    var starts: [Int: CGFloat] = [:]
    var ends: [Int: CGFloat] = [:]
    func spread(_ indices: [Int], along frame: CGRect, into ys: inout [Int: CGFloat]) {
      let spacing = min(9, (frame.height - 16) / CGFloat(max(1, indices.count - 1)))
      for (place, index) in indices.enumerated() {
        ys[index] = frame.midY + (CGFloat(place) - CGFloat(indices.count - 1) / 2) * spacing
      }
    }
    for (node, indices) in Dictionary(grouping: drawn, by: { edges[$0].from }) {
      guard let frame = frames[node] else { continue }
      let ordered = indices.sorted { (frames[edges[$0].to]?.midY ?? 0) < (frames[edges[$1].to]?.midY ?? 0) }
      spread(ordered, along: frame, into: &starts)
    }
    for (node, indices) in Dictionary(grouping: drawn, by: { edges[$0].to }) {
      guard let frame = frames[node] else { continue }
      let ordered = indices.sorted { (frames[edges[$0].from]?.midY ?? 0) < (frames[edges[$1].from]?.midY ?? 0) }
      spread(ordered, along: frame, into: &ends)
    }
    var ports: [Int: (start: CGPoint, end: CGPoint)] = [:]
    for index in drawn {
      guard let from = frames[edges[index].from], let to = frames[edges[index].to] else { continue }
      ports[index] = (
        CGPoint(x: from.maxX, y: starts[index] ?? from.midY), CGPoint(x: to.minX, y: ends[index] ?? to.midY)
      )
    }
    return ports
  }

  private func draw(
    _ edge: BlockingMap.Edge, ports: (start: CGPoint, end: CGPoint)?, lit: Bool, in context: inout GraphicsContext
  ) {
    guard let ports, let from = frames[edge.from], let to = frames[edge.to] else { return }
    let color: Color =
      edge.cycle ? .orange : lit ? .accentColor : Color.secondary.opacity(edge.closed ? 0.4 : 0.6)
    let dash: [CGFloat] = edge.cycle ? [2, 4] : edge.closed ? [5, 4] : []
    let end = ports.end
    context.stroke(
      path(from: from, to: to, start: ports.start, end: CGPoint(x: end.x - 5, y: end.y)), with: .color(color),
      style: StrokeStyle(lineWidth: lit ? 2 : 1.5, lineCap: .round, lineJoin: .round, dash: dash))
    var head = Path()
    head.move(to: end)
    head.addLine(to: CGPoint(x: end.x - 8, y: end.y - 4.5))
    head.addLine(to: CGPoint(x: end.x - 8, y: end.y + 4.5))
    head.closeSubpath()
    context.fill(head, with: .color(color))
  }

  private func path(from: CGRect, to: CGRect, start: CGPoint, end: CGPoint) -> Path {
    let low = min(start.y, end.y) - 6
    let high = max(start.y, end.y) + 6
    let left = min(from.maxX, to.minX)
    let right = max(from.maxX, to.minX)
    let between = frames.values.filter { $0.minX > left && $0.maxX < right }
    let blocked = between.contains { $0.maxY > low && $0.minY < high }
    var path = Path()
    path.move(to: start)
    if end.x > start.x, !blocked {
      let bend = max(24, (end.x - start.x) / 2)
      path.addCurve(
        to: end, control1: CGPoint(x: start.x + bend, y: start.y), control2: CGPoint(x: end.x - bend, y: end.y))
      return path
    }
    // Over everything between, in the lane above the cards.
    let top = ([from, to] + between).map(\.minY).min().map { $0 - MapMetrics.lane * 0.6 } ?? start.y
    let turn: CGFloat = 22
    path.addCurve(
      to: CGPoint(x: start.x + turn, y: top), control1: CGPoint(x: start.x + turn, y: start.y),
      control2: CGPoint(x: start.x + turn, y: top + 4))
    path.addLine(to: CGPoint(x: end.x - turn, y: top))
    path.addCurve(
      to: end, control1: CGPoint(x: end.x - turn, y: top + 4), control2: CGPoint(x: end.x - turn, y: end.y))
    return path
  }
}
