import CoreGraphics
import Foundation

/// Where a blocking map's cards, ends and arrows go: a column per step,
/// the issue's in the middle, what blocks it before and what it blocks
/// after, as the desktop app lays it out. The core decides each card's
/// step; this decides only the order within a step, the places, and the
/// arrows' routes, so that the app draws what it is given.
///
/// The steps run along an axis: left to right, as on the desktop, or top
/// to bottom. Within a step, cards stand in the order that crosses the
/// fewest arrows the layout can cheaply find: each next to the cards
/// nearer the issue it is linked to. A step with more cards than
/// `Metrics.cardsPerStep` shows that many and a control for the rest,
/// unless it is in `expandedSteps`.
public struct BlockingMapLayout: Hashable, Sendable {
    /// Which way the steps run.
    public enum Axis: Hashable, Sendable {
        /// Columns, left to right, as on the desktop.
        case horizontal
        /// Rows, top to bottom.
        case vertical
    }

    /// The sizes the layout works with, which the app takes from the text
    /// size.
    public struct Metrics: Hashable, Sendable {
        /// A card's size on screen.
        public var cardSize: CGSize
        /// The size of an end's control, and of a step's control for the
        /// cards it does not show, across the step (its other side is the
        /// card's).
        public var controlSize: CGSize
        /// Between one step's cards and the next step's.
        public var stepGap: CGFloat
        /// Between the cards of a step.
        public var cardGap: CGFloat
        /// Room for a step's title before its cards.
        public var titleHeight: CGFloat
        /// Room beside the cards for arrows that go around them.
        public var lane: CGFloat
        /// How far an arrow bends out of a card on its way to the lane.
        public var turn: CGFloat
        /// Around everything, for the badges and shadows that stand out.
        public var padding: CGFloat
        /// The length of an arrow's head.
        public var head: CGFloat
        /// The most room arrows leaving or reaching one card keep apart.
        public var portSpacing: CGFloat
        /// The most cards a step shows unless expanded.
        public var cardsPerStep: Int

        public init(
            cardSize: CGSize, controlSize: CGSize, stepGap: CGFloat, cardGap: CGFloat, titleHeight: CGFloat,
            lane: CGFloat, turn: CGFloat, padding: CGFloat, head: CGFloat = 7, portSpacing: CGFloat = 8,
            cardsPerStep: Int = 6
        ) {
            self.cardSize = cardSize
            self.controlSize = controlSize
            self.stepGap = stepGap
            self.cardGap = cardGap
            self.titleHeight = titleHeight
            self.lane = lane
            self.turn = turn
            self.padding = padding
            self.head = head
            self.portSpacing = portSpacing
            self.cardsPerStep = cardsPerStep
        }
    }

    /// What stands at a place on the map.
    public enum Content: Hashable, Sendable {
        case card(BlockingMap.Card)
        /// A side's end: more to read, reading, or fewer to show.
        case end(BlockingSide, BlockingEnd)
        /// A step's cards beyond those it shows, `hidden` of them, or,
        /// with none hidden, the control that shows fewer again.
        case stepToggle(step: Int, hidden: Int)
    }

    public struct Node: Hashable, Sendable, Identifiable {
        /// The issue's ID for a card; `edge:blockedBy` or `edge:blocking`
        /// for an end, as the core names them in edges; `step:<n>` for a
        /// step's toggle.
        public var id: String
        public var content: Content
        public var step: Int
        public var frame: CGRect
        /// Its place in reading order: step by step, outwards from the
        /// first, then down or along the step.
        public var order: Int

        public var card: BlockingMap.Card? {
            if case .card(let card) = content { card } else { nil }
        }
    }

    /// A step that holds cards, with where its title goes.
    public struct Step: Hashable, Sendable, Identifiable {
        public var step: Int
        public var title: String
        public var titleFrame: CGRect
        public var id: Int { step }
    }

    /// How an arrow runs.
    public enum Route: Hashable, Sendable {
        /// Straight on, curving from one card to the next.
        case direct
        /// Out into the lane beside the cards, along it and back in, at
        /// this distance across the steps: round the cards in the way, or
        /// back against the steps for a cycle.
        case lane(CGFloat)
    }

    public struct Arrow: Hashable, Sendable, Identifiable {
        /// From the blocker to the issue that waits, as the core says.
        public var from: String
        public var to: String
        public var cycle: Bool
        public var closed: Bool
        /// Where it leaves its blocker.
        public var start: CGPoint
        /// Where its line ends and its head begins.
        public var end: CGPoint
        /// Where its head points to, on the edge of what waits.
        public var tip: CGPoint
        public var route: Route

        public var id: String { "\(from)>\(to)" }
    }

    /// A piece of an arrow's line.
    public enum Segment: Hashable, Sendable {
        case move(CGPoint)
        case line(CGPoint)
        case curve(CGPoint, control1: CGPoint, control2: CGPoint)
    }

    public var axis: Axis
    public var nodes: [Node]
    public var steps: [Step]
    public var arrows: [Arrow]
    public var size: CGSize
    /// How far an arrow bends on its way to the lane, for drawing it.
    public var turn: CGFloat

    /// The node of the map's issue.
    public func node(_ id: String) -> Node? { nodes.first { $0.id == id } }

    /// The ID of a side's end, as the core names it in edges.
    public static func endId(_ side: BlockingSide) -> String { "edge:\(side.rawValue)" }

    /// What a step's title says, as on the desktop.
    public static func title(ofStep step: Int) -> String {
        switch step {
        case -1: "Blocked by"
        case 0: "This issue"
        case 1: "Blocks"
        default: "\(abs(step)) steps \(step < 0 ? "back" : "on")"
        }
    }

    // MARK: - Laying out

    /// Lays out `map`, whose issue is `root`.
    public init(
        map: BlockingMap, root: String, metrics: Metrics, axis: Axis = .horizontal, expandedSteps: Set<Int> = []
    ) {
        self.axis = axis
        self.turn = metrics.turn
        let discovery = Dictionary(map.cards.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { first, _ in first })
        let byStep = Dictionary(grouping: map.cards, by: \.step)
        let cardSteps = map.cards.map(\.step)
        let firstCardStep = min(0, cardSteps.min() ?? 0)
        let lastCardStep = max(0, cardSteps.max() ?? 0)
        var endSteps: [Int: BlockingSide] = [:]
        for side in BlockingSide.allCases where map.ends[side] != .none {
            endSteps[side == .blockedBy ? firstCardStep - 1 : lastCardStep + 1] = side
        }

        // The arrows in the core's terms, with one from each branch that
        // goes on to its side's end, even before anything has been folded
        // there, as the desktop draws them.
        var edges = map.edges
        for card in map.cards {
            for side in BlockingSide.allCases {
                guard let badge = card.badges[side], badge != .closed, map.ends[side] != .none else { continue }
                let end = Self.endId(side)
                let (from, to) = side == .blockedBy ? (end, card.id) : (card.id, end)
                if !edges.contains(where: { $0.from == from && $0.to == to }) {
                    edges.append(BlockingMap.Edge(from: from, to: to, cycle: false, closed: false))
                }
            }
        }

        // Placed outwards from the issue, so that each step orders itself
        // by the steps nearer the issue, which stand already.
        let cross = CrossPlacement(metrics: metrics, axis: axis)
        var centres: [String: CGFloat] = [:]
        var standIn: [String: String] = [:]
        var placed: [Int: [(id: String, content: Content)]] = [:]
        let allSteps = Array((endSteps.keys.min() ?? firstCardStep)...(endSteps.keys.max() ?? lastCardStep))
        let outwards = [0] + allSteps.filter { $0 > 0 }.sorted() + allSteps.filter { $0 < 0 }.sorted(by: >)
        for step in outwards {
            var members: [(id: String, content: Content)]
            if let side = endSteps[step] {
                members = [(Self.endId(side), .end(side, map.ends[side]))]
            } else {
                members = (byStep[step] ?? []).map { ($0.id, .card($0)) }
            }
            func neighbours(of id: String) -> [CGFloat] {
                edges.filter { !$0.cycle }.compactMap { edge in
                    let other = edge.from == id ? edge.to : edge.to == id ? edge.from : nil
                    return other.flatMap { centres[standIn[$0] ?? $0] }
                }
            }
            let barycentres = Dictionary(
                members.map { member in
                    let known = neighbours(of: member.id)
                    return (member.id, known.isEmpty ? nil : known.reduce(0, +) / CGFloat(known.count))
                }, uniquingKeysWith: { first, _ in first })
            members.sort { a, b in
                let (x, y) = (barycentres[a.id] ?? nil, barycentres[b.id] ?? nil)
                if let x, let y, x != y { return x < y }
                if (x == nil) != (y == nil) { return x != nil }
                return (discovery[a.id] ?? 0) < (discovery[b.id] ?? 0)
            }
            // A long step shows its first cards and a toggle for the rest.
            let limit = max(1, metrics.cardsPerStep)
            var shown = members
            var desired = members.map { barycentres[$0.id] ?? nil }
            if step != 0, endSteps[step] == nil, members.count > limit {
                let toggle = "step:\(step)"
                if expandedSteps.contains(step) {
                    shown.append((toggle, .stepToggle(step: step, hidden: 0)))
                    desired.append(nil)
                } else {
                    let hidden = members.dropFirst(limit)
                    for member in hidden { standIn[member.id] = toggle }
                    let known = hidden.flatMap { neighbours(of: $0.id) }
                    shown = Array(members.prefix(limit)) + [(toggle, .stepToggle(step: step, hidden: hidden.count))]
                    desired = Array(desired.prefix(limit)) + [known.isEmpty ? nil : known.reduce(0, +) / CGFloat(known.count)]
                }
            }
            let sizes = shown.map { cross.extent(of: $0.content) }
            for (member, centre) in zip(shown, cross.place(desired: desired, sizes: sizes)) {
                centres[member.id] = centre
            }
            placed[step] = shown
        }

        // The steps along the axis, each as long as what it holds.
        let ordered = allSteps
        let titled = { (step: Int) in endSteps[step] == nil }
        var mainStarts: [Int: CGFloat] = [:]
        var mainLengths: [Int: CGFloat] = [:]
        var position = metrics.padding
        for step in ordered {
            let length = endSteps[step] != nil ? cross.mainLength(ofControl: true) : cross.mainLength(ofControl: false)
            mainStarts[step] = position
            mainLengths[step] = length
            switch axis {
            case .horizontal: position += length + metrics.stepGap
            case .vertical: position += (titled(step) ? metrics.titleHeight : 0) + length + metrics.stepGap
            }
        }
        let mainEnd = position - metrics.stepGap + metrics.padding

        let extents = placed.values.joined().map { (centres[$0.id] ?? 0, cross.extent(of: $0.content)) }
        let lowest = extents.map { $0.0 - $0.1 / 2 }.min() ?? 0
        let highest = extents.map { $0.0 + $0.1 / 2 }.max() ?? 0
        let crossOrigin =
            metrics.padding + metrics.lane + (axis == .horizontal ? metrics.titleHeight : 0) - lowest
        let crossEnd = crossOrigin + highest + metrics.padding
        let laneCentre = crossOrigin + lowest - metrics.lane * 0.55

        func point(main: CGFloat, cross: CGFloat) -> CGPoint {
            axis == .horizontal ? CGPoint(x: main, y: cross) : CGPoint(x: cross, y: main)
        }
        func rect(main: CGFloat, cross: CGFloat, mainLength: CGFloat, crossLength: CGFloat) -> CGRect {
            axis == .horizontal
                ? CGRect(x: main, y: cross, width: mainLength, height: crossLength)
                : CGRect(x: cross, y: main, width: crossLength, height: mainLength)
        }

        var nodes: [Node] = []
        var steps: [Step] = []
        for (index, step) in ordered.enumerated() {
            guard let start = mainStarts[step] else { continue }
            let cardsStart = start + (axis == .vertical && titled(step) ? metrics.titleHeight : 0)
            if titled(step) {
                let titleFrame =
                    axis == .horizontal
                    ? CGRect(x: start, y: metrics.padding, width: mainLengths[step] ?? 0, height: metrics.titleHeight)
                    : CGRect(
                        x: crossOrigin + lowest, y: start, width: max(0, highest - lowest),
                        height: metrics.titleHeight)
                steps.append(Step(step: step, title: Self.title(ofStep: step), titleFrame: titleFrame))
            }
            for (row, member) in (placed[step] ?? []).enumerated() {
                let extent = cross.extent(of: member.content)
                let mainLength = cross.mainLength(of: member.content)
                let centre = crossOrigin + (centres[member.id] ?? 0)
                // A control shorter than its step stands in its middle.
                let main = cardsStart + ((mainLengths[step] ?? mainLength) - mainLength) / 2
                nodes.append(
                    Node(
                        id: member.id, content: member.content, step: step,
                        frame: rect(main: main, cross: centre - extent / 2, mainLength: mainLength, crossLength: extent),
                        order: index * 1000 + row))
            }
        }

        // The arrows between what shows: one to a card that does not show
        // ends at the toggle standing for it.
        var shownEdges: [BlockingMap.Edge] = []
        let shownIds = Set(nodes.map(\.id))
        for edge in edges {
            var edge = edge
            edge.from = standIn[edge.from] ?? edge.from
            edge.to = standIn[edge.to] ?? edge.to
            guard edge.from != edge.to, shownIds.contains(edge.from), shownIds.contains(edge.to) else { continue }
            if let index = shownEdges.firstIndex(where: { $0.from == edge.from && $0.to == edge.to }) {
                shownEdges[index].cycle = shownEdges[index].cycle || edge.cycle
                shownEdges[index].closed = shownEdges[index].closed && edge.closed
            } else {
                shownEdges.append(edge)
            }
        }
        let frames = Dictionary(nodes.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let main = { (rect: CGRect) in axis == .horizontal ? (rect.minX, rect.maxX) : (rect.minY, rect.maxY) }
        let across = { (rect: CGRect) in axis == .horizontal ? (rect.minY, rect.maxY) : (rect.minX, rect.maxX) }
        let routes = shownEdges.map { edge -> Route in
            guard let from = frames[edge.from], let to = frames[edge.to] else { return .direct }
            if edge.cycle || to.step <= from.step { return .lane(laneCentre) }
            let (a, b) = (across(from.frame), across(to.frame))
            let low = min((a.0 + a.1) / 2, (b.0 + b.1) / 2) - 4
            let high = max((a.0 + a.1) / 2, (b.0 + b.1) / 2) + 4
            // Past empty steps it runs straight; round a card in the way.
            let inTheWay = nodes.contains { node in
                node.step > from.step && node.step < to.step && across(node.frame).1 > low && across(node.frame).0 < high
            }
            return inTheWay ? .lane(laneCentre) : .direct
        }

        // Arrows that leave or reach one card spread along its side in the
        // order of their other ends, so that they do not cross there. Those
        // in the lane come from, or go to, its side.
        func crossCentre(_ id: String) -> CGFloat {
            frames[id].map { let (a, b) = across($0.frame); return (a + b) / 2 } ?? 0
        }
        func ports(grouping key: (BlockingMap.Edge) -> String, other: (BlockingMap.Edge) -> String) -> [Int: CGFloat] {
            var result: [Int: CGFloat] = [:]
            for (id, indices) in Dictionary(grouping: shownEdges.indices, by: { key(shownEdges[$0]) }) {
                guard let node = frames[id] else { continue }
                let sorted = indices.sorted { a, b in
                    let x = routes[a] == .direct ? crossCentre(other(shownEdges[a])) : -.infinity
                    let y = routes[b] == .direct ? crossCentre(other(shownEdges[b])) : -.infinity
                    return x != y ? x < y : a < b
                }
                let (low, high) = across(node.frame)
                let room = max(0, high - low - 2 * min(12, (high - low) / 4))
                let spacing = sorted.count > 1 ? min(metrics.portSpacing, room / CGFloat(sorted.count - 1)) : 0
                for (place, index) in sorted.enumerated() {
                    result[index] = (low + high) / 2 + (CGFloat(place) - CGFloat(sorted.count - 1) / 2) * spacing
                }
            }
            return result
        }
        let starts = ports(grouping: \.from, other: \.to)
        let ends = ports(grouping: \.to, other: \.from)
        var arrows: [Arrow] = []
        for (index, edge) in shownEdges.enumerated() {
            guard let from = frames[edge.from], let to = frames[edge.to] else { continue }
            let exit = main(from.frame).1
            let entry = main(to.frame).0
            let startCross = starts[index] ?? crossCentre(edge.from)
            let endCross = ends[index] ?? crossCentre(edge.to)
            arrows.append(
                Arrow(
                    from: edge.from, to: edge.to, cycle: edge.cycle, closed: edge.closed,
                    start: point(main: exit, cross: startCross),
                    end: point(main: entry - metrics.head, cross: endCross),
                    tip: point(main: entry, cross: endCross), route: routes[index]))
        }

        self.nodes = nodes.sorted { $0.order < $1.order }
        self.steps = steps
        self.arrows = arrows
        self.size = axis == .horizontal ? CGSize(width: mainEnd, height: crossEnd) : CGSize(width: crossEnd, height: mainEnd)
    }

    // MARK: - Drawing arrows

    /// An arrow's line, from where it leaves its blocker to where its head
    /// begins. The app draws it from the points, so that an arrow can move
    /// with its cards.
    public static func segments(from start: CGPoint, to end: CGPoint, route: Route, axis: Axis, turn: CGFloat) -> [Segment]
    {
        // Worked out as if the steps ran left to right, then turned.
        let flip = { (point: CGPoint) in axis == .horizontal ? point : CGPoint(x: point.y, y: point.x) }
        let (a, b) = (flip(start), flip(end))
        var segments: [Segment] = [.move(a)]
        switch route {
        case .direct:
            let bend = max(turn, (b.x - a.x) / 2)
            segments.append(.curve(b, control1: CGPoint(x: a.x + bend, y: a.y), control2: CGPoint(x: b.x - bend, y: b.y)))
        case .lane(let lane):
            let out = CGPoint(x: a.x + turn, y: lane)
            let back = CGPoint(x: b.x - turn, y: lane)
            let toward: CGFloat = lane < a.y ? 1 : -1
            segments.append(
                .curve(out, control1: CGPoint(x: a.x + turn, y: a.y), control2: CGPoint(x: a.x + turn, y: lane + 4 * toward)))
            segments.append(.line(back))
            segments.append(
                .curve(b, control1: CGPoint(x: b.x - turn, y: lane + 4 * toward), control2: CGPoint(x: b.x - turn, y: b.y)))
        }
        return segments.map { segment in
            switch segment {
            case .move(let point): .move(flip(point))
            case .line(let point): .line(flip(point))
            case .curve(let point, let control1, let control2):
                .curve(flip(point), control1: flip(control1), control2: flip(control2))
            }
        }
    }

    /// The arrow's head: its tip and the two corners behind it.
    public static func head(tip: CGPoint, end: CGPoint, width: CGFloat = 9) -> [CGPoint] {
        let length = max(0.001, hypot(tip.x - end.x, tip.y - end.y))
        let (dx, dy) = ((tip.x - end.x) / length, (tip.y - end.y) / length)
        let half = width / 2
        return [
            tip, CGPoint(x: end.x - dy * half, y: end.y + dx * half), CGPoint(x: end.x + dy * half, y: end.y - dx * half),
        ]
    }
}

/// Places a step's nodes across it.
private struct CrossPlacement {
    var metrics: BlockingMapLayout.Metrics
    var axis: BlockingMapLayout.Axis

    /// How much room a node takes across its step.
    func extent(of content: BlockingMapLayout.Content) -> CGFloat {
        switch (content, axis) {
        case (.card, .horizontal): metrics.cardSize.height
        case (.card, .vertical): metrics.cardSize.width
        case (_, .horizontal): metrics.controlSize.height
        case (_, .vertical): metrics.controlSize.width
        }
    }

    /// How long a node is along the steps: a step's toggle is as long as
    /// its cards, an end as its control.
    func mainLength(of content: BlockingMapLayout.Content) -> CGFloat {
        if case .end = content { mainLength(ofControl: true) } else { mainLength(ofControl: false) }
    }

    func mainLength(ofControl control: Bool) -> CGFloat {
        switch (control, axis) {
        case (false, .horizontal): metrics.cardSize.width
        case (false, .vertical): metrics.cardSize.height
        case (true, .horizontal): metrics.controlSize.width
        case (true, .vertical): metrics.controlSize.height
        }
    }

    /// The centres across the step, in order, each as near to where it
    /// would be best, `desired` (none for no preference), as the gaps
    /// between them allow: the least squares, found by pooling neighbours
    /// that would otherwise overlap.
    func place(desired: [CGFloat?], sizes: [CGFloat]) -> [CGFloat] {
        guard !sizes.isEmpty else { return [] }
        // Each centre's least distance from the first, packed tight.
        var offsets: [CGFloat] = [0]
        for index in sizes.indices.dropFirst() {
            offsets.append(offsets[index - 1] + (sizes[index - 1] + sizes[index]) / 2 + metrics.cardGap)
        }
        // Without any preference, the step is centred.
        let anyDesired = desired.contains { $0 != nil }
        let packedMiddle = (offsets.last ?? 0) / 2
        struct Pool {
            var weight: CGFloat
            var sum: CGFloat
            var count: Int
            var mean: CGFloat { sum / weight }
        }
        var pools: [Pool] = []
        for index in sizes.indices {
            let wanted = desired[index] ?? (anyDesired ? nil : offsets[index] - packedMiddle)
            let weight: CGFloat = wanted == nil ? 0.001 : 1
            let target = (wanted ?? 0) - offsets[index]
            pools.append(Pool(weight: weight, sum: target * weight, count: 1))
            while pools.count > 1, pools[pools.count - 2].mean > pools[pools.count - 1].mean {
                let last = pools.removeLast()
                pools[pools.count - 1].weight += last.weight
                pools[pools.count - 1].sum += last.sum
                pools[pools.count - 1].count += last.count
            }
        }
        var centres: [CGFloat] = []
        for pool in pools {
            for _ in 0..<pool.count { centres.append(pool.mean + offsets[centres.count]) }
        }
        return centres
    }
}
