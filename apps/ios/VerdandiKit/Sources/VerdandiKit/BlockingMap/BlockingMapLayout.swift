import CoreGraphics
import Foundation

/// Where a blocking map's cards, ends and arrows go: a column per step,
/// the issue's in the middle, what blocks it to the left and what it blocks
/// to the right, as the desktop app lays it out. The core decides each
/// card's step; this decides only the order within a column, the places,
/// and the arrows' routes, so that the app draws what it is given.
///
/// Within a column, cards stand in the order that crosses the fewest arrows
/// the layout can cheaply find: each level with the cards nearer the issue
/// it is linked to, as far as the column allows. A column with more cards
/// than `Metrics.cardsPerStep` shows that many and a toggle for the rest,
/// unless its step is in `expandedSteps`.
public struct BlockingMapLayout: Hashable, Sendable {
    /// The sizes the layout works with, which the app takes from the text
    /// size.
    public struct Metrics: Hashable, Sendable {
        public var cardSize: CGSize
        /// An end's control. A column's toggle is as wide as its cards and
        /// as tall as this.
        public var controlSize: CGSize
        /// Between one column's cards and the next column's.
        public var stepGap: CGFloat
        /// Between the cards of a column.
        public var cardGap: CGFloat
        /// Room for the columns' titles, above everything.
        public var titleHeight: CGFloat
        /// Room between the titles and the cards for arrows that go round
        /// the cards.
        public var lane: CGFloat
        /// How far an arrow bends out of a card on its way to the lane.
        public var turn: CGFloat
        /// Around everything, for the badges and shadows that stand out.
        public var padding: CGFloat
        /// The length of an arrow's head.
        public var head: CGFloat
        /// The most room arrows leaving or reaching one card keep apart.
        public var portSpacing: CGFloat
        /// The most cards a column shows unless expanded.
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
        /// A column's cards beyond those it shows, `hidden` of them, or,
        /// with none hidden, the toggle that shows fewer again.
        case stepToggle(step: Int, hidden: Int)
    }

    public struct Node: Hashable, Sendable, Identifiable {
        /// The issue's ID for a card; `edge:blockedBy` or `edge:blocking`
        /// for an end, as the core names them in edges; `step:<n>` for a
        /// column's toggle.
        public var id: String
        public var content: Content
        public var step: Int
        public var frame: CGRect
        /// Its place in reading order: column by column, top to bottom.
        public var order: Int

        public var card: BlockingMap.Card? {
            if case .card(let card) = content { card } else { nil }
        }
    }

    /// A column that holds cards, with where its title goes.
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
        /// Up over the cards, along at this height and back down: round the
        /// cards in the way, or back to the left for a cycle. It runs as low
        /// as clears them, and no higher than the lane below the titles.
        case lane(CGFloat)
    }

    public struct Arrow: Hashable, Sendable, Identifiable {
        /// From the blocker to the issue that waits, as the core says.
        public var from: String
        public var to: String
        public var cycle: Bool
        public var closed: Bool
        /// Where it leaves its blocker, on its right side.
        public var start: CGPoint
        /// Where its line ends and its head begins.
        public var end: CGPoint
        /// Where its head points to, on the left side of what waits.
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

    public var nodes: [Node]
    public var steps: [Step]
    public var arrows: [Arrow]
    public var size: CGSize
    /// How far an arrow bends on its way to the lane, for drawing it.
    public var turn: CGFloat

    public func node(_ id: String) -> Node? { nodes.first { $0.id == id } }

    /// The ID of a side's end, as the core names it in edges.
    public static func endId(_ side: BlockingSide) -> String { "edge:\(side.rawValue)" }

    /// What a column's title says, as on the desktop.
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
    public init(map: BlockingMap, root: String, metrics: Metrics, expandedSteps: Set<Int> = []) {
        turn = metrics.turn
        let discovery = Dictionary(map.cards.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { first, _ in first })
        let byStep = Dictionary(grouping: map.cards, by: \.step)
        let cardSteps = map.cards.map(\.step)
        let firstCardStep = min(0, cardSteps.min() ?? 0)
        let lastCardStep = max(0, cardSteps.max() ?? 0)
        var endSteps: [Int: BlockingSide] = [:]
        for side in BlockingSide.allCases where map.ends[side] != .none {
            endSteps[side == .blockedBy ? firstCardStep - 1 : lastCardStep + 1] = side
        }
        let allSteps = Array((endSteps.keys.min() ?? firstCardStep)...(endSteps.keys.max() ?? lastCardStep))

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
        let ordering = edges.filter { !$0.cycle }

        // Placed outwards from the issue, so that each column orders itself
        // by the columns nearer the issue, which stand already. Heights are
        // relative to the issue's middle until the end.
        var middles: [String: CGFloat] = [:]
        var standIn: [String: String] = [:]
        var placed: [Int: [(id: String, content: Content)]] = [:]
        let outwards = [0] + allSteps.filter { $0 > 0 } + allSteps.filter { $0 < 0 }.reversed()
        for step in outwards {
            var members: [(id: String, content: Content)]
            if let side = endSteps[step] {
                members = [(Self.endId(side), .end(side, map.ends[side]))]
            } else {
                members = (byStep[step] ?? []).map { (id: $0.id, content: .card($0)) }
            }
            /// The middle of the placed cards it is linked to, if any.
            func barycentre(of ids: [String]) -> CGFloat? {
                let known = ordering.compactMap { edge -> CGFloat? in
                    let other = ids.contains(edge.from) ? edge.to : ids.contains(edge.to) ? edge.from : nil
                    return other.flatMap { middles[standIn[$0] ?? $0] }
                }
                return known.isEmpty ? nil : known.reduce(0, +) / CGFloat(known.count)
            }
            let wanted = Dictionary(
                members.map { ($0.id, barycentre(of: [$0.id])) }, uniquingKeysWith: { first, _ in first })
            members.sort { a, b in
                switch (wanted[a.id] ?? nil, wanted[b.id] ?? nil) {
                case (let x?, let y?) where x != y: return x < y
                case (.some, nil): return true
                case (nil, .some): return false
                default: return (discovery[a.id] ?? 0) < (discovery[b.id] ?? 0)
                }
            }
            // A long column shows its first cards and a toggle for the rest.
            var shown = members
            var desired = members.map { wanted[$0.id] ?? nil }
            let limit = max(1, metrics.cardsPerStep)
            if step != 0, endSteps[step] == nil, members.count > limit {
                let toggle = "step:\(step)"
                if expandedSteps.contains(step) {
                    shown.append((toggle, .stepToggle(step: step, hidden: 0)))
                    desired.append(nil)
                } else {
                    let hidden = Array(members.dropFirst(limit))
                    shown = Array(members.prefix(limit)) + [(toggle, .stepToggle(step: step, hidden: hidden.count))]
                    desired = Array(desired.prefix(limit)) + [barycentre(of: hidden.map(\.id))]
                    for member in hidden { standIn[member.id] = toggle }
                }
            }
            let heights = shown.map { Self.height(of: $0.content, metrics) }
            for (member, middle) in zip(shown, Self.place(desired: desired, heights: heights, gap: metrics.cardGap)) {
                middles[member.id] = middle
            }
            placed[step] = shown
        }

        // The columns, left to right, each as wide as what it holds.
        var lefts: [Int: CGFloat] = [:]
        var widths: [Int: CGFloat] = [:]
        var x = metrics.padding
        for step in allSteps {
            let width = endSteps[step] == nil ? metrics.cardSize.width : metrics.controlSize.width
            lefts[step] = x
            widths[step] = width
            x += width + metrics.stepGap
        }
        let width = x - metrics.stepGap + metrics.padding

        let spans = placed.values.joined().map { (middles[$0.id] ?? 0, Self.height(of: $0.content, metrics)) }
        let highest = spans.map { $0.0 - $0.1 / 2 }.min() ?? 0
        let lowest = spans.map { $0.0 + $0.1 / 2 }.max() ?? 0
        let cardsTop = metrics.padding + metrics.titleHeight + metrics.lane
        let shift = cardsTop - highest
        let lane = cardsTop - metrics.lane * 0.55

        var nodes: [Node] = []
        var steps: [Step] = []
        for (column, step) in allSteps.enumerated() {
            guard let left = lefts[step], let columnWidth = widths[step] else { continue }
            if endSteps[step] == nil {
                steps.append(
                    Step(
                        step: step, title: Self.title(ofStep: step),
                        titleFrame: CGRect(x: left, y: metrics.padding, width: columnWidth, height: metrics.titleHeight)))
            }
            for (row, member) in (placed[step] ?? []).enumerated() {
                let size = Self.size(of: member.content, metrics)
                let middle = shift + (middles[member.id] ?? 0)
                nodes.append(
                    Node(
                        id: member.id, content: member.content, step: step,
                        frame: CGRect(
                            x: left + (columnWidth - size.width) / 2, y: middle - size.height / 2, width: size.width,
                            height: size.height),
                        order: column * 1000 + row))
            }
        }

        // The arrows between what shows: one to a card that does not show
        // ends at the toggle standing for it.
        let shownIds = Set(nodes.map(\.id))
        var shownEdges: [BlockingMap.Edge] = []
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
        let byId = Dictionary(nodes.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        /// Just above its ends and every card in the columns between them,
        /// rather than up at the top of the map.
        func laneOver(_ from: Node, _ to: Node) -> Route {
            let (left, right) = (min(from.step, to.step), max(from.step, to.step))
            let between = nodes.filter { $0.step > left && $0.step < right }
            let top = ([from, to] + between).map(\.frame.minY).min() ?? cardsTop
            return .lane(max(lane, top - metrics.lane * 0.55))
        }
        let routes = shownEdges.map { edge -> Route in
            guard let from = byId[edge.from], let to = byId[edge.to] else { return .direct }
            if edge.cycle || to.step <= from.step { return laneOver(from, to) }
            let top = min(from.frame.midY, to.frame.midY) - 4
            let bottom = max(from.frame.midY, to.frame.midY) + 4
            // Past empty columns it runs straight; round a card in the way.
            let inTheWay = nodes.contains { node in
                node.step > from.step && node.step < to.step && node.frame.maxY > top && node.frame.minY < bottom
            }
            return inTheWay ? laneOver(from, to) : .direct
        }

        // Arrows that leave or reach one card spread along its side in the
        // order of their other ends, so that they do not cross there. Those
        // in the lane leave and arrive at the top.
        func ports(of key: KeyPath<BlockingMap.Edge, String>, other: KeyPath<BlockingMap.Edge, String>) -> [Int: CGFloat] {
            var result: [Int: CGFloat] = [:]
            for (id, indices) in Dictionary(grouping: shownEdges.indices, by: { shownEdges[$0][keyPath: key] }) {
                guard let node = byId[id] else { continue }
                let sorted = indices.sorted { a, b in
                    let y = routes[a] == .direct ? byId[shownEdges[a][keyPath: other]]?.frame.midY ?? 0 : -.infinity
                    let z = routes[b] == .direct ? byId[shownEdges[b][keyPath: other]]?.frame.midY ?? 0 : -.infinity
                    return y != z ? y < z : a < b
                }
                let height = node.frame.height
                let room = max(0, height - 2 * min(12, height / 4))
                let spacing = sorted.count > 1 ? min(metrics.portSpacing, room / CGFloat(sorted.count - 1)) : 0
                for (place, index) in sorted.enumerated() {
                    result[index] = node.frame.midY + (CGFloat(place) - CGFloat(sorted.count - 1) / 2) * spacing
                }
            }
            return result
        }
        let starts = ports(of: \.from, other: \.to)
        let ends = ports(of: \.to, other: \.from)
        var arrows: [Arrow] = []
        for (index, edge) in shownEdges.enumerated() {
            guard let from = byId[edge.from], let to = byId[edge.to] else { continue }
            let startY = starts[index] ?? from.frame.midY
            let endY = ends[index] ?? to.frame.midY
            arrows.append(
                Arrow(
                    from: edge.from, to: edge.to, cycle: edge.cycle, closed: edge.closed,
                    start: CGPoint(x: from.frame.maxX, y: startY),
                    end: CGPoint(x: to.frame.minX - metrics.head, y: endY),
                    tip: CGPoint(x: to.frame.minX, y: endY), route: routes[index]))
        }

        self.nodes = nodes
        self.steps = steps
        self.arrows = arrows
        size = CGSize(width: width, height: shift + lowest + metrics.padding)
    }

    private static func size(of content: Content, _ metrics: Metrics) -> CGSize {
        switch content {
        case .card: metrics.cardSize
        case .end: metrics.controlSize
        case .stepToggle: CGSize(width: metrics.cardSize.width, height: metrics.controlSize.height)
        }
    }

    private static func height(of content: Content, _ metrics: Metrics) -> CGFloat {
        size(of: content, metrics).height
    }

    /// The middles down a column, in order, each as near to where it would
    /// be best, `desired` (none for no preference), as the gaps between them
    /// allow: the least squares, found by pooling neighbours that would
    /// otherwise overlap. Without any preference, the column is centred.
    static func place(desired: [CGFloat?], heights: [CGFloat], gap: CGFloat) -> [CGFloat] {
        guard !heights.isEmpty else { return [] }
        // Each middle's least distance from the first, packed tight.
        var offsets: [CGFloat] = [0]
        for index in heights.indices.dropFirst() {
            offsets.append(offsets[index - 1] + (heights[index - 1] + heights[index]) / 2 + gap)
        }
        let anyDesired = desired.contains { $0 != nil }
        let packedMiddle = (offsets.last ?? 0) / 2
        struct Pool {
            var weight: CGFloat
            var sum: CGFloat
            var count: Int
            var mean: CGFloat { sum / weight }
        }
        var pools: [Pool] = []
        for index in heights.indices {
            let wanted = desired[index] ?? (anyDesired ? nil : offsets[index] - packedMiddle)
            // One without a preference only fills in between the others.
            let weight: CGFloat = wanted == nil ? 0.001 : 1
            pools.append(Pool(weight: weight, sum: ((wanted ?? 0) - offsets[index]) * weight, count: 1))
            while pools.count > 1, pools[pools.count - 2].mean > pools[pools.count - 1].mean {
                let last = pools.removeLast()
                pools[pools.count - 1].weight += last.weight
                pools[pools.count - 1].sum += last.sum
                pools[pools.count - 1].count += last.count
            }
        }
        var middles: [CGFloat] = []
        for pool in pools {
            for _ in 0..<pool.count { middles.append(pool.mean + offsets[middles.count]) }
        }
        return middles
    }

    // MARK: - Drawing arrows

    /// An arrow's line, from where it leaves its blocker to where its head
    /// begins. The app draws it from the points, so that an arrow can move
    /// with its cards.
    public static func segments(from start: CGPoint, to end: CGPoint, route: Route, turn: CGFloat) -> [Segment] {
        switch route {
        case .direct:
            let bend = max(turn, (end.x - start.x) / 2)
            return [
                .move(start),
                .curve(end, control1: CGPoint(x: start.x + bend, y: start.y), control2: CGPoint(x: end.x - bend, y: end.y)),
            ]
        case .lane(let lane):
            let toward: CGFloat = lane < start.y ? 4 : -4
            return [
                .move(start),
                .curve(
                    CGPoint(x: start.x + turn, y: lane), control1: CGPoint(x: start.x + turn, y: start.y),
                    control2: CGPoint(x: start.x + turn, y: lane + toward)),
                .line(CGPoint(x: end.x - turn, y: lane)),
                .curve(
                    end, control1: CGPoint(x: end.x - turn, y: lane + toward), control2: CGPoint(x: end.x - turn, y: end.y)),
            ]
        }
    }

    /// An arrow's head: its tip and the two corners behind it.
    public static func head(tip: CGPoint, end: CGPoint, width: CGFloat = 9) -> [CGPoint] {
        let length = max(0.001, hypot(tip.x - end.x, tip.y - end.y))
        let (dx, dy) = ((tip.x - end.x) / length, (tip.y - end.y) / length)
        let half = width / 2
        return [
            tip, CGPoint(x: end.x - dy * half, y: end.y + dx * half), CGPoint(x: end.x + dy * half, y: end.y - dx * half),
        ]
    }
}
