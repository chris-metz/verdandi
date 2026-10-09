import SwiftUI
import VerdandiKit

/// The blocking map: the issues that block this one, step by step before
/// it, and those it blocks after it, with arrows from each blocker to what
/// it blocks, as the desktop app draws it. A section of the issue page, as
/// wide as the page: it insets its own content by the page's margins, so
/// that the map scrolls sideways from edge to edge, and is as tall as it
/// needs.
///
/// Tapping a card opens its issue from this one; the ends past the last
/// steps read further, stop reading, or fold back. The core decides each
/// card's step; `BlockingMapLayout` places the cards and routes the arrows.
struct BlockingMapView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.palette) private var palette
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var map: BlockingMap
    /// The issue whose page shows the map.
    var issueId: String

    /// The steps whose cards all show, though there are many.
    @State private var expandedSteps: Set<Int> = []
    @State private var width: CGFloat = 0
    @State private var measured = BlockingMapMetrics.Measured()
    /// Each card's step as last shown, to see which came in or moved.
    @State private var shownSteps: [String: Int]?
    @State private var flashes: [String: BlockingMapFlash] = [:]
    @State private var changes = 0
    /// Whether the launch has pressed the end it asked for.
    @State private var launchEndPressed = false

    /// The page's margin, by which the map insets its content.
    static func margin(_ sizeClass: UserInterfaceSizeClass?) -> CGFloat { sizeClass == .compact ? 16 : 20 }

    var body: some View {
        let margin = Self.margin(sizeClass)
        VStack(alignment: .leading, spacing: 10) {
            if map.cards.isEmpty {
                EmptyView()
            } else if isolated {
                Label("Nothing blocks this issue, and it blocks nothing.", systemImage: "circle.dashed")
                    .font(.subheadline)
                    .foregroundStyle(palette.muted)
                    .padding(.horizontal, margin)
            } else {
                BlockingMapCanvas(
                    layout: layout, issueId: issueId, rootRepository: rootRepository, flashes: flashes,
                    margin: margin, snaps: compact,
                    open: { model.openIssue(IssueRoute($0.issue), fromPage: true) },
                    activate: activate, retry: retry, toggle: toggle)
            }
            if map.edges.contains(where: \.cycle) {
                Label(
                    "Some of these issues block each other in a circle: the dotted red arrows.",
                    systemImage: "arrow.trianglehead.2.clockwise.rotate.90"
                )
                .font(.footnote)
                .foregroundStyle(palette.blocked)
                .padding(.horizontal, margin)
            }
            if !map.problems.isEmpty {
                BlockingMapProblems(problems: map.problems) { Task { await model.retry() } }
                    .padding(.horizontal, margin)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .background { BlockingMapProbe(measured: $measured) }
        .onChange(of: map, initial: true) { _, map in
            noteChanges(in: map)
            pressLaunchEnd(of: map)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Blocking map")
    }

    // MARK: - Layout

    /// On a narrow screen, each swipe comes to rest on a column.
    private var compact: Bool { sizeClass == .compact }

    private var layout: BlockingMapLayout {
        let metrics = BlockingMapMetrics(
            compact: compact, viewport: width - 2 * Self.margin(sizeClass), measured: measured)
        return BlockingMapLayout(map: map, root: issueId, metrics: metrics.layout, expandedSteps: expandedSteps)
    }

    private var rootRepository: RepositoryAddress? {
        map.cards.first { $0.id == issueId }?.issue.repository
    }

    /// Whether the issue stands alone: nothing blocks it, it blocks
    /// nothing, and nothing is left to read.
    private var isolated: Bool {
        map.cards.allSatisfy { $0.id == issueId && $0.badges.blockedBy == nil && $0.badges.blocking == nil }
            && map.ends.blockedBy == .none && map.ends.blocking == .none
    }

    // MARK: - Acting

    private func activate(_ side: BlockingSide) {
        guard let core = model.core else { return }
        Task { await model.attempt { try await core.activateBlockingEnd(issueId, side: side) } }
    }

    private func retry(_ card: BlockingMap.Card, _ side: BlockingSide) {
        guard let core = model.core else { return }
        Task { await model.attempt { try await core.retryBlockingBranch(issueId, cardId: card.id, side: side) } }
    }

    private func toggle(_ step: Int) {
        withAnimation(reduceMotion ? nil : .smooth) {
            if expandedSteps.contains(step) { expandedSteps.remove(step) } else { expandedSteps.insert(step) }
        }
    }

    /// Presses the end a launch for development asked for, once it offers
    /// to read further.
    private func pressLaunchEnd(of map: BlockingMap) {
        guard !launchEndPressed, let side = model.launch.mapEnd else { return }
        switch map.ends[side] {
        case .folded, .unknown, .paused:
            launchEndPressed = true
            activate(side)
        default:
            return
        }
    }

    /// Cards that came in flash in the theme's `map-new`, those that moved
    /// to another step in `map-moved`, as on the desktop; not when the map
    /// first shows. Only the last change flashes, so that a card shown
    /// again later does not flash for an old one.
    private func noteChanges(in map: BlockingMap) {
        let steps = Dictionary(map.cards.map { ($0.id, $0.step) }, uniquingKeysWith: { first, _ in first })
        defer { shownSteps = steps }
        guard let before = shownSteps, before != steps else { return }
        changes += 1
        var next: [String: BlockingMapFlash] = [:]
        for (id, step) in steps where id != issueId && before[id] != step {
            next[id] = BlockingMapFlash(moved: before[id] != nil, token: changes)
        }
        flashes = next
    }
}

/// The map itself, which scrolls sideways: the steps' titles, the arrows
/// behind and the cards and controls over them. It opens with the issue in
/// the middle, and keeps the issue where it is as steps come in before it.
private struct BlockingMapCanvas: View {
    @Environment(\.palette) private var palette
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var layout: BlockingMapLayout
    var issueId: String
    var rootRepository: RepositoryAddress?
    var flashes: [String: BlockingMapFlash]
    var margin: CGFloat
    /// Whether a swipe comes to rest with a step in the middle.
    var snaps: Bool
    var open: (BlockingMap.Card) -> Void
    var activate: (BlockingSide) -> Void
    var retry: (BlockingMap.Card, BlockingSide) -> Void
    var toggle: (Int) -> Void

    @State private var position = ScrollPosition()
    @State private var scrolled = Scrolled()
    @State private var phase: ScrollPhase = .idle
    /// Where the issue's middle stands, from the leading edge of what
    /// shows, as the user last left it; in the middle until they scroll.
    @State private var anchor: CGFloat?
    /// Where a scroll this view asked for is going, while it animates.
    @State private var requested: CGFloat?
    @State private var activations = 0

    /// What of the content shows, and how wide it is.
    private struct Scrolled: Equatable {
        var visible: CGRect = .zero
        var contentWidth: CGFloat = 0
    }

    private var visible: CGRect { scrolled.visible }

    var body: some View {
        ScrollView(.horizontal) {
            content
                .frame(width: contentWidth, height: layout.size.height)
        }
        .scrollIndicators(.hidden)
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        .contentMargins(.horizontal, margin, for: .scrollContent)
        .scrollPosition($position)
        .scrollTargetBehavior(StepSnapping(centres: snaps ? stepCentres : [], margin: margin))
        .onScrollGeometryChange(for: Scrolled.self) {
            Scrolled(visible: $0.visibleRect, contentWidth: $0.contentSize.width)
        } action: { _, new in
            scrolled = new
            keepRoot(animated: false)
        }
        .onScrollPhaseChange { old, new in
            phase = new
            guard new == .idle else { return }
            // Only where the user leaves it: a scroll of this view's own may
            // have ended short of an issue that moved meanwhile.
            if [.tracking, .interacting, .decelerating].contains(old), let rootCentre, visible.width > 0 {
                anchor = rootCentre - visible.minX
            }
            requested = nil
            keepRoot(animated: false)
        }
        .frame(height: layout.size.height)
        .onChange(of: rootCentre) { keepRoot(animated: true) }
        .sensoryFeedback(.impact(weight: .light), trigger: activations)
    }

    private var content: some View {
        ZStack(alignment: .topLeading) {
            BlockingMapArrows(layout: layout)
            ForEach(layout.steps) { step in
                title(step)
                    .frame(width: step.titleFrame.width, height: step.titleFrame.height, alignment: .leading)
                    .offset(x: step.titleFrame.minX, y: step.titleFrame.minY)
            }
            ForEach(layout.nodes) { node in
                nodeView(node)
                    .frame(width: node.frame.width, height: node.frame.height)
                    .offset(x: node.frame.minX, y: node.frame.minY)
                    .transition(.opacity.combined(with: .scale(scale: 0.92)))
                    .accessibilitySortPriority(Double(-node.order))
            }
        }
        .frame(width: layout.size.width, height: layout.size.height, alignment: .topLeading)
        .animation(reduceMotion ? nil : .smooth(duration: 0.45), value: layout)
        // VoiceOver reads it column by column, as `order` says.
        .accessibilityElement(children: .contain)
    }

    private func title(_ step: BlockingMapLayout.Step) -> some View {
        Text(step.title)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(step.step == 0 ? palette.accent : palette.muted)
            .lineLimit(1)
            .accessibilityHidden(true)
    }

    @ViewBuilder private func nodeView(_ node: BlockingMapLayout.Node) -> some View {
        switch node.content {
        case .card(let card):
            cardView(card, node: node)
        case .end(let side, let end):
            BlockingMapEndControl(side: side, end: end, size: node.frame.size) {
                activations += 1
                activate(side)
            }
        case .stepToggle(let step, let hidden):
            BlockingMapStepToggle(hidden: hidden, size: node.frame.size) { toggle(step) }
        }
    }

    @ViewBuilder private func cardView(_ card: BlockingMap.Card, node: BlockingMapLayout.Node) -> some View {
        let isRoot = card.id == issueId
        let face = BlockingMapCard(
            card: card, isRoot: isRoot, rootRepository: rootRepository, size: node.frame.size,
            flash: flashes[card.id])
        Group {
            if isRoot {
                face.accessibilityElement(children: .ignore)
            } else {
                Button { open(card) } label: { face }
                    .buttonStyle(MapCardButtonStyle())
                    .hoverEffect(.lift)
                    .accessibilityHint("Opens its page.")
            }
        }
        .contextMenu { menu(for: card) }
        .accessibilityLabel(accessibilityLabel(card, node: node))
        .accessibilityValue(accessibilityValue(card))
        .overlay { badges(of: card) }
    }

    @ViewBuilder private func badges(of card: BlockingMap.Card) -> some View {
        ForEach(BlockingSide.allCases, id: \.self) { side in
            if let badge = card.badges[side] {
                let (alignment, offset) = BlockingMapBadge.placement(of: side)
                BlockingMapBadge(badge: badge, side: side) { retry(card, side) }
                    .offset(offset)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: alignment)
            }
        }
    }

    @ViewBuilder private func menu(for card: BlockingMap.Card) -> some View {
        if let url = URL(string: card.issue.url) {
            Button("Open on GitHub", systemImage: "safari") { openURL(url) }
            Button("Copy Link", systemImage: "link") { UIPasteboard.general.url = url }
        }
        ForEach(BlockingSide.allCases, id: \.self) { side in
            if case .failed = card.badges[side] {
                Button(side == .blockedBy ? "Retry Its Blockers" : "Retry What It Blocks", systemImage: "arrow.clockwise") {
                    retry(card, side)
                }
            }
        }
    }

    // MARK: - Words for VoiceOver

    private func reference(_ issue: IssueInfo) -> String {
        let number = issue.number.map(String.init) ?? ""
        if let rootRepository, rootRepository.sameRepository(as: issue.repository), !issue.external {
            return "#\(number)"
        }
        return issue.qualifiedReference
    }

    private func accessibilityLabel(_ card: BlockingMap.Card, node: BlockingMapLayout.Node) -> String {
        "\(BlockingMapLayout.title(ofStep: node.step)): \(reference(card.issue)), \(card.issue.title)"
    }

    private func accessibilityValue(_ card: BlockingMap.Card) -> String {
        let issue = card.issue
        var parts = [issue.state == .open ? "Open" : "Closed"]
        if issue.state == .open, let open = issue.blockedBy?.open, open > 0 { parts.append("blocked") }
        if issue.external { parts.append("outside your tracked repositories") }
        let labels = (issue.labels ?? []).map(\.name)
        if !labels.isEmpty { parts.append("labels \(labels.joined(separator: ", "))") }
        return parts.joined(separator: ", ")
    }

    // MARK: - Scrolling

    /// Where the content starts within the scroll view's content, when the
    /// map is narrower than the screen and stands in its middle.
    private var inset: CGFloat {
        max(0, (visible.width - 2 * margin - layout.size.width) / 2)
    }

    private var rootCentre: CGFloat? {
        layout.node(issueId).map { $0.frame.midX + inset }
    }

    private var stepCentres: [CGFloat] {
        var centres: [Int: (CGFloat, CGFloat)] = [:]
        for node in layout.nodes {
            let (low, high) = centres[node.step] ?? (.infinity, -.infinity)
            centres[node.step] = (min(low, node.frame.minX), max(high, node.frame.maxX))
        }
        return centres.values.map { ($0.0 + $0.1) / 2 + inset }.sorted()
    }

    /// Keeps the issue where it stands on screen, in the middle at first,
    /// as steps come in before it, unless the user is scrolling. The content
    /// may not have grown yet: then it waits for it.
    private func keepRoot(animated: Bool) {
        guard phase == .idle || phase == .animating, visible.width > 0, let rootCentre,
            scrolled.contentWidth >= contentWidth - 0.5
        else { return }
        let lowest = -margin
        let highest = max(lowest, scrolled.contentWidth + margin - visible.width)
        let target = min(max(rootCentre - (anchor ?? visible.width / 2), lowest), highest)
        // While a scroll of its own animates, only a new target counts.
        let heading = phase == .animating ? requested ?? visible.minX : visible.minX
        guard abs(target - heading) > 0.5 else { return }
        requested = target
        // Once the content has its new size: a scroll asked for in the same
        // update as it grows ends where the old size allowed.
        Task { @MainActor in
            withAnimation(animated && !reduceMotion ? .smooth(duration: 0.45) : nil) {
                position.scrollTo(x: target)
            }
        }
    }

    /// The content's width, at least what shows.
    private var contentWidth: CGFloat { max(layout.size.width, visible.width - 2 * margin) }
}

/// A card's press: it gives a little, as a button does.
private struct MapCardButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .brightness(configuration.isPressed ? -0.02 : 0)
            .animation(.snappy(duration: 0.18), value: configuration.isPressed)
    }
}

/// On a narrow screen, a sideways swipe comes to rest with a step in the
/// middle, at least one step on from where it began.
private struct StepSnapping: ScrollTargetBehavior {
    /// The steps' middles, in the content's coordinates.
    var centres: [CGFloat]
    var margin: CGFloat

    func updateTarget(_ target: inout ScrollTarget, context: TargetContext) {
        guard !centres.isEmpty else { return }
        let width = target.rect.width
        func nearest(to x: CGFloat) -> Int {
            centres.indices.min { abs(centres[$0] - x) < abs(centres[$1] - x) } ?? 0
        }
        var index = nearest(to: target.rect.midX)
        let start = nearest(to: context.originalTarget.rect.midX)
        if index == start, abs(context.velocity.dx) > 0.2 {
            index = min(max(0, start + (context.velocity.dx > 0 ? 1 : -1)), centres.count - 1)
        }
        let lowest = -margin
        let highest = max(lowest, context.contentSize.width + margin - width)
        target.rect.origin.x = min(max(centres[index] - width / 2, lowest), highest)
    }
}

/// What could not be read of the map, and a way to read it again.
private struct BlockingMapProblems: View {
    @Environment(\.palette) private var palette
    var problems: [Problem]
    var retry: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: "exclamationmark.triangle")
                .foregroundStyle(palette.warning)
            VStack(alignment: .leading, spacing: 2) {
                Text("Some blocking relationships could not be loaded.")
                    .font(.subheadline.weight(.semibold))
                Text(details)
                    .font(.footnote)
                    .foregroundStyle(palette.muted)
            }
            Spacer(minLength: 0)
            Button("Retry", action: retry)
                .buttonStyle(.glass)
                .controlSize(.small)
        }
        .padding(12)
        .background(palette.warning.opacity(0.12), in: .rect(cornerRadius: 14))
    }

    /// Each reason once.
    private var details: String {
        var seen: [String] = []
        for problem in problems where !seen.contains(problem.message) { seen.append(problem.message) }
        return seen.joined(separator: " ")
    }
}
