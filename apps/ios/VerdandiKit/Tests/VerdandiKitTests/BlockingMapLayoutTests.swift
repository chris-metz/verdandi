import CoreGraphics
import Testing

@testable import VerdandiKit

/// A made-up blocking map, each issue named by its ID: cards by step, and
/// arrows from each blocker to what it blocks.
private struct MapBuilder {
    var cards: [BlockingMap.Card] = []
    var edges: [BlockingMap.Edge] = []
    var ends = BlockingMap.Ends(blockedBy: .none, blocking: .none)

    mutating func card(_ id: String, _ step: Int, state: IssueState = .open, badges: BlockingMap.Badges = .init()) {
        let issue = IssueInfo(
            id: id, repository: RepositoryAddress(owner: "acme", name: "api"), reference: "#\(id)", title: id,
            state: state, url: "https://github.com/acme/api/issues/1", external: false)
        cards.append(BlockingMap.Card(issue: issue, step: step, badges: badges))
    }

    mutating func block(_ blocker: String, _ blocked: String, cycle: Bool = false, closed: Bool = false) {
        edges.append(BlockingMap.Edge(from: blocker, to: blocked, cycle: cycle, closed: closed))
    }

    var map: BlockingMap { BlockingMap(cards: cards, edges: edges, ends: ends, problems: []) }
}

private let metrics = BlockingMapLayout.Metrics(
    cardSize: CGSize(width: 200, height: 100), controlSize: CGSize(width: 120, height: 50), stepGap: 40,
    cardGap: 10, titleHeight: 20, lane: 30, turn: 20, padding: 10, cardsPerStep: 6)

private func layout(_ builder: MapBuilder, expanded: Set<Int> = []) -> BlockingMapLayout {
    BlockingMapLayout(map: builder.map, root: "root", metrics: metrics, expandedSteps: expanded)
}

/// The IDs of a step's nodes, top to bottom.
private func column(_ layout: BlockingMapLayout, _ step: Int) -> [String] {
    layout.nodes.filter { $0.step == step }.sorted { $0.frame.minY < $1.frame.minY }.map(\.id)
}

private func frame(_ layout: BlockingMapLayout, _ id: String) -> CGRect {
    layout.node(id)?.frame ?? .null
}

private func arrows(_ layout: BlockingMapLayout) -> Set<String> {
    Set(layout.arrows.map { "\($0.from)>\($0.to)" })
}

@Suite struct BlockingMapLayoutTests {
    @Test func putsBlockersBeforeTheIssueAndWhatItBlocksAfter() {
        var builder = MapBuilder()
        builder.card("root", 0)
        builder.card("a", -1)
        builder.card("b", -1)
        builder.card("c", 1)
        builder.card("d", 2)
        builder.block("a", "root")
        builder.block("b", "root")
        builder.block("root", "c")
        builder.block("c", "d")
        let map = layout(builder)

        #expect(map.steps.map(\.title) == ["Blocked by", "This issue", "Blocks", "2 steps on"])
        #expect(frame(map, "a").minX == metrics.padding)
        #expect(frame(map, "root").minX == metrics.padding + 240)
        #expect(frame(map, "c").minX == metrics.padding + 480)
        #expect(frame(map, "d").minX == metrics.padding + 720)
        #expect(map.size.width == metrics.padding * 2 + 4 * 200 + 3 * 40)
        // Titles stand above their cards, the lane between them.
        #expect(map.steps.allSatisfy { $0.titleFrame.minY == metrics.padding })
        #expect(map.nodes.map(\.frame.minY).min() == metrics.padding + metrics.titleHeight + metrics.lane)
        #expect(arrows(map) == ["a>root", "b>root", "root>c", "c>d"])
    }

    @Test func centresAStepOnTheCardsItIsLinkedTo() {
        var builder = MapBuilder()
        builder.card("root", 0)
        builder.card("a", -1)
        builder.card("b", -1)
        builder.card("c", 1)
        builder.block("a", "root")
        builder.block("b", "root")
        builder.block("root", "c")
        let map = layout(builder)

        #expect(column(map, -1) == ["a", "b"])
        #expect(frame(map, "b").minY - frame(map, "a").maxY == metrics.cardGap)
        #expect(frame(map, "a").maxY + metrics.cardGap / 2 == frame(map, "root").midY)
        #expect(frame(map, "c").midY == frame(map, "root").midY)
    }

    @Test func ordersAStepByTheCardsItIsLinkedTo() {
        var builder = MapBuilder()
        builder.card("root", 0)
        builder.card("x", 1)
        builder.card("y", 1)
        // Read first, though it hangs off the lower card.
        builder.card("p", 2)
        builder.card("q", 2)
        builder.block("root", "x")
        builder.block("root", "y")
        builder.block("y", "p")
        builder.block("x", "q")
        let map = layout(builder)

        #expect(column(map, 1) == ["x", "y"])
        #expect(column(map, 2) == ["q", "p"])
        // Each stays level with what it hangs off.
        #expect(frame(map, "q").midY == frame(map, "x").midY)
        #expect(frame(map, "p").midY == frame(map, "y").midY)
    }

    @Test func foldsALongStepBehindItsToggle() {
        var builder = MapBuilder()
        builder.card("root", 0)
        for index in 1...8 {
            builder.card("b\(index)", -1)
            builder.block("b\(index)", "root")
        }
        let folded = layout(builder)

        #expect(column(folded, -1) == ["b1", "b2", "b3", "b4", "b5", "b6", "step:-1"])
        #expect(folded.node("step:-1")?.content == .stepToggle(step: -1, hidden: 2))
        #expect(folded.node("step:-1")?.frame.height == metrics.controlSize.height)
        #expect(folded.node("step:-1")?.frame.width == metrics.cardSize.width)
        // The cards it hides reach the issue through it, with one arrow.
        #expect(folded.arrows.filter { $0.from == "step:-1" }.count == 1)

        let expanded = layout(builder, expanded: [-1])
        #expect(column(expanded, -1).count == 9)
        #expect(expanded.node("step:-1")?.content == .stepToggle(step: -1, hidden: 0))
        #expect(arrows(expanded).contains("b8>root"))
    }

    @Test func neverFoldsTheIssue() {
        var builder = MapBuilder()
        builder.card("root", 0)
        let map = BlockingMapLayout(
            map: builder.map, root: "root",
            metrics: { var small = metrics; small.cardsPerStep = 1; return small }())
        #expect(column(map, 0) == ["root"])
    }

    @Test func putsEachSidesEndBeyondItsLastStep() {
        var builder = MapBuilder()
        builder.card("root", 0, badges: .init(blockedBy: .unloaded(count: 2)))
        builder.card("c", 1)
        builder.card("d", 2, badges: .init(blocking: .unloaded(count: 3)))
        builder.card("e", 2, state: .closed, badges: .init(blocking: .closed))
        builder.block("root", "c")
        builder.block("c", "d")
        builder.block("c", "e", closed: true)
        builder.block("d", BlockingMapLayout.endId(.blocking))
        builder.ends = .init(blockedBy: .unknown, blocking: .folded(count: 4))
        let map = layout(builder)

        #expect(map.node("edge:blocking")?.step == 3)
        #expect(map.node("edge:blocking")?.content == .end(.blocking, .folded(count: 4)))
        #expect(map.node("edge:blockedBy")?.step == -1)
        // Ends have no titles, and are as small as their controls.
        #expect(map.steps.map(\.step) == [0, 1, 2])
        #expect(map.node("edge:blocking")?.frame.size == metrics.controlSize)
        // A branch with more to read leads to its side's end; a closed one
        // is not followed.
        #expect(
            arrows(map) == ["edge:blockedBy>root", "root>c", "c>d", "c>e", "d>edge:blocking"])
        #expect(map.arrows.first { $0.to == "e" }?.closed == true)
    }

    @Test func leavesOutEndsWithNothingToShow() {
        var builder = MapBuilder()
        builder.card("root", 0, badges: .init(blockedBy: .loading, blocking: .loading))
        let map = layout(builder)

        #expect(map.nodes.map(\.id) == ["root"])
        #expect(map.arrows.isEmpty)
        #expect(map.steps.map(\.title) == ["This issue"])
    }

    @Test func runsArrowsStraightToTheEndsPastEmptySteps() {
        var builder = MapBuilder()
        builder.card("root", 0, badges: .init(blockedBy: .loading, blocking: .loading))
        builder.ends = .init(blockedBy: .unknown, blocking: .unknown)
        let map = layout(builder)

        #expect(arrows(map) == ["edge:blockedBy>root", "root>edge:blocking"])
        #expect(map.arrows.allSatisfy { $0.route == .direct })
    }

    @Test func takesTheLaneForCyclesAndAroundCardsInTheWay() {
        var builder = MapBuilder()
        builder.card("root", 0)
        builder.card("near", 1)
        builder.card("far", 2)
        builder.block("root", "near")
        builder.block("near", "far")
        // Placed by its longest route, past a card level with it.
        builder.block("root", "far")
        builder.block("far", "root", cycle: true)
        let map = layout(builder)

        let route = { (from: String, to: String) in map.arrows.first { $0.from == from && $0.to == to }?.route }
        #expect(route("root", "near") == .direct)
        #expect(route("near", "far") == .direct)
        guard case .lane(let lane) = route("root", "far"), case .lane(let cycleLane) = route("far", "root") else {
            Issue.record("Expected both arrows in the lane")
            return
        }
        // The lane runs between the titles and the cards.
        #expect(lane == cycleLane)
        #expect(lane > metrics.padding + metrics.titleHeight)
        #expect(lane < frame(map, "root").minY)
        #expect(map.arrows.first { $0.cycle }.map { "\($0.from)>\($0.to)" } == "far>root")
    }

    @Test func goesRoundJustAboveTheCardsItPasses() {
        var builder = MapBuilder()
        builder.card("root", 0)
        // A tall column elsewhere, which the arrow need not climb over.
        for index in 1...4 {
            builder.card("b\(index)", -1)
            builder.block("b\(index)", "root")
        }
        builder.card("near", 1)
        builder.card("far", 2)
        builder.block("root", "near")
        builder.block("near", "far")
        builder.block("root", "far")
        let map = layout(builder)

        let top = map.nodes.map(\.frame.minY).min() ?? 0
        let route = map.arrows.first { $0.from == "root" && $0.to == "far" }?.route
        #expect(frame(map, "root").minY > top + 100)
        #expect(route == .lane(frame(map, "root").minY - metrics.lane * 0.55))
    }

    @Test func spreadsArrowsAlongACardsSide() {
        var builder = MapBuilder()
        builder.card("root", 0)
        for id in ["x", "y", "z"] {
            builder.card(id, 1)
            builder.block("root", id)
        }
        let map = layout(builder)

        let starts = ["x", "y", "z"].compactMap { id in map.arrows.first { $0.to == id }?.start }
        #expect(starts.map(\.y) == [frame(map, "root").midY - 8, frame(map, "root").midY, frame(map, "root").midY + 8])
        #expect(starts.allSatisfy { $0.x == frame(map, "root").maxX })
        // Each reaches the middle of its card's side, its head on the edge.
        for id in ["x", "y", "z"] {
            let arrow = map.arrows.first { $0.to == id }
            #expect(arrow?.tip == CGPoint(x: frame(map, id).minX, y: frame(map, id).midY))
            #expect(arrow?.end == CGPoint(x: frame(map, id).minX - metrics.head, y: frame(map, id).midY))
        }
    }

    @Test func readsStepByStep() {
        var builder = MapBuilder()
        builder.card("root", 0)
        builder.card("a", -1)
        builder.card("b", -1)
        builder.card("c", 1)
        builder.block("a", "root")
        builder.block("b", "root")
        builder.block("root", "c")
        #expect(layout(builder).nodes.map(\.id) == ["a", "b", "root", "c"])
    }

    @Test func drawsADirectArrowAsOneCurveAndALaneArrowRoundIt() {
        let start = CGPoint(x: 100, y: 50)
        let end = CGPoint(x: 200, y: 90)
        let direct = BlockingMapLayout.segments(from: start, to: end, route: .direct, turn: 20)
        #expect(
            direct == [.move(start), .curve(end, control1: CGPoint(x: 150, y: 50), control2: CGPoint(x: 150, y: 90))])

        let lane = BlockingMapLayout.segments(from: start, to: end, route: .lane(10), turn: 20)
        #expect(lane.count == 4)
        #expect(lane[1] == .curve(CGPoint(x: 120, y: 10), control1: CGPoint(x: 120, y: 50), control2: CGPoint(x: 120, y: 14)))
        #expect(lane[2] == .line(CGPoint(x: 180, y: 10)))
        #expect(lane[3] == .curve(end, control1: CGPoint(x: 180, y: 14), control2: CGPoint(x: 180, y: 90)))
    }

    @Test func placesAColumnAsNearAsItCanToWhereEachCardWouldBe() {
        // Both want the same place: they share it, a gap apart.
        #expect(BlockingMapLayout.place(desired: [0, 0], heights: [100, 100], gap: 10) == [-55, 55])
        // Apart enough already, each keeps its own.
        #expect(BlockingMapLayout.place(desired: [-200, 200], heights: [100, 100], gap: 10) == [-200, 200])
        // Without a preference, it fills in after the one before.
        let filled = BlockingMapLayout.place(desired: [40, nil], heights: [100, 50], gap: 10)
        #expect(abs(filled[0] - 40) < 0.5 && abs(filled[1] - 125) < 0.5)
        // With none at all, the column is centred.
        #expect(BlockingMapLayout.place(desired: [nil, nil, nil], heights: [100, 100, 100], gap: 10) == [-110, 0, 110])
    }

    @Test func pointsTheHeadAlongTheArrow() {
        let head = BlockingMapLayout.head(tip: CGPoint(x: 10, y: 0), end: CGPoint(x: 0, y: 0), width: 8)
        #expect(head == [CGPoint(x: 10, y: 0), CGPoint(x: 0, y: 4), CGPoint(x: 0, y: -4)])
    }

    @Test func namesTheSteps() {
        #expect((-3...3).map(BlockingMapLayout.title(ofStep:)) == [
            "3 steps back", "2 steps back", "Blocked by", "This issue", "Blocks", "2 steps on", "3 steps on",
        ])
    }
}
