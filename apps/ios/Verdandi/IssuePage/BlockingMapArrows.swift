import SwiftUI
import VerdandiKit

/// The map's arrows, behind its cards, each from a blocker to the issue
/// that waits: faint and solid while both are open, dashed past a closed
/// one, and dotted in the blocked colour where issues block each other in a
/// circle. Each is a shape of its ends, so that it moves with its cards as
/// they move.
struct BlockingMapArrows: View {
    @Environment(\.palette) private var palette
    var layout: BlockingMapLayout

    var body: some View {
        ZStack {
            ForEach(layout.arrows) { arrow in
                let color = arrow.cycle ? palette.blocked : palette.muted.opacity(arrow.closed ? 0.45 : 0.6)
                ZStack {
                    ArrowLine(arrow: arrow, turn: layout.turn)
                        .stroke(
                            color,
                            style: StrokeStyle(
                                lineWidth: 1.5, lineCap: .round, lineJoin: .round,
                                dash: arrow.cycle ? [2, 4] : arrow.closed ? [6, 5] : []))
                    ArrowHead(tip: arrow.tip, end: arrow.end).fill(color)
                }
                .transition(.opacity)
            }
        }
        .frame(width: layout.size.width, height: layout.size.height)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// An arrow's line, drawn as the layout routes it from its two ends.
private nonisolated struct ArrowLine: Shape {
    var start: CGPoint
    var end: CGPoint
    var lane: CGFloat
    var inLane: Bool
    var turn: CGFloat

    init(arrow: BlockingMapLayout.Arrow, turn: CGFloat) {
        start = arrow.start
        end = arrow.end
        if case .lane(let lane) = arrow.route {
            self.lane = lane
            inLane = true
        } else {
            lane = 0
            inLane = false
        }
        self.turn = turn
    }

    var animatableData: AnimatablePair<AnimatablePair<CGPoint.AnimatableData, CGPoint.AnimatableData>, CGFloat> {
        get { AnimatablePair(AnimatablePair(start.animatableData, end.animatableData), lane) }
        set {
            start.animatableData = newValue.first.first
            end.animatableData = newValue.first.second
            lane = newValue.second
        }
    }

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let segments = BlockingMapLayout.segments(
            from: start, to: end, route: inLane ? .lane(lane) : .direct, turn: turn)
        for segment in segments {
            switch segment {
            case .move(let point): path.move(to: point)
            case .line(let point): path.addLine(to: point)
            case .curve(let point, let control1, let control2):
                path.addCurve(to: point, control1: control1, control2: control2)
            }
        }
        return path
    }
}

/// An arrow's head, on the edge of the issue that waits.
private nonisolated struct ArrowHead: Shape {
    var tip: CGPoint
    var end: CGPoint

    var animatableData: AnimatablePair<CGPoint.AnimatableData, CGPoint.AnimatableData> {
        get { AnimatablePair(tip.animatableData, end.animatableData) }
        set {
            tip.animatableData = newValue.first
            end.animatableData = newValue.second
        }
    }

    func path(in rect: CGRect) -> Path {
        Path { path in
            path.addLines(BlockingMapLayout.head(tip: tip, end: end))
            path.closeSubpath()
        }
    }
}
