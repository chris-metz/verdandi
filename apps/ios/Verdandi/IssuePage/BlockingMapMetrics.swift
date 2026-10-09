import SwiftUI
import VerdandiKit

/// The blocking map's sizes for the text size the user chose: what holds
/// text grows with it, so that a card always has room for its header, three
/// lines of title and its labels. Every card is as tall as the tallest
/// could be, so that the map's steps line up as a grid, as on the desktop.
struct BlockingMapMetrics {
    /// The lines of a card's title.
    static let titleLines = 3

    var layout: BlockingMapLayout.Metrics

    /// The sizes for the text as `measured`, on a screen `viewport` points
    /// wide, narrow (`compact`) or not.
    init(compact: Bool, viewport: CGFloat, measured: Measured) {
        let scale = measured.scale
        // Until the page has its width, as wide as an iPhone's.
        let viewport = viewport > 0 ? viewport : 370
        let stepGap = ((compact ? 46 : 44) + (compact ? 6 : 12) * scale).rounded()
        // Wide enough for a title of three lines; on a narrow screen, never
        // so wide that the columns beside the issue's do not peek in.
        let widest = compact ? max(180, viewport - 2 * stepGap - 32) : 360
        let cardWidth = min(((compact ? 200 : 216) * scale).rounded(), widest.rounded(.down))
        let controlWidth = min(cardWidth, (156 * scale).rounded())
        layout = BlockingMapLayout.Metrics(
            cardSize: CGSize(width: cardWidth, height: measured.cardHeight.rounded(.up)),
            controlSize: CGSize(width: controlWidth, height: (measured.controlTextHeight + 22).rounded(.up)),
            stepGap: stepGap, cardGap: 14,
            titleHeight: (measured.titleHeight + 10).rounded(.up),
            lane: 26, turn: 22, padding: 14, head: 7, portSpacing: 8,
            cardsPerStep: 6)
    }

    /// The heights of the map's text as SwiftUI sets it, which a hidden
    /// probe measures; until it has, an estimate at the default size.
    struct Measured: Equatable {
        /// A card's height, with three lines of title.
        var cardHeight: CGFloat = 112
        /// The two lines of an end's control.
        var controlTextHeight: CGFloat = 36
        /// A step's title.
        var titleHeight: CGFloat = 18
        /// A line of a card's title, which says how much larger than the
        /// default the text is.
        var titleLine: CGFloat = 18

        var scale: CGFloat { max(0.8, titleLine / 18) }
    }

    /// A card's spacing, which its height is measured with.
    enum Card {
        static let horizontalPadding: CGFloat = 12
        static let verticalPadding: CGFloat = 10
        static let spacing: CGFloat = 5
        static let labelsHeight: CGFloat = 8
        static let cornerRadius: CGFloat = 14
    }
}

/// Measures the map's text, hidden: a card with three lines of title, an
/// end's two lines and a step's title, in the fonts they show in.
struct BlockingMapProbe: View {
    @Binding var measured: BlockingMapMetrics.Measured

    var body: some View {
        ZStack(alignment: .topLeading) {
            VStack(alignment: .leading, spacing: BlockingMapMetrics.Card.spacing) {
                HStack(spacing: 5) {
                    StateIcon(state: .open, reason: nil).font(.caption)
                    Text(verbatim: "owner/name").font(.caption2.weight(.medium)).padding(.vertical, 1)
                    Text(verbatim: "#0").font(.caption.monospacedDigit())
                }
                Text(verbatim: "X\nX\nX")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(BlockingMapMetrics.titleLines)
                Color.clear.frame(height: BlockingMapMetrics.Card.labelsHeight)
            }
            .padding(.vertical, BlockingMapMetrics.Card.verticalPadding)
            .fixedSize()
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { measured.cardHeight = $0 + 2 }
            Text(verbatim: "X")
                .font(.subheadline.weight(.semibold))
                .fixedSize()
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { measured.titleLine = $0 }
            VStack(spacing: 1) {
                Text(verbatim: "X").font(.subheadline.weight(.semibold))
                Text(verbatim: "X").font(.caption)
            }
            .fixedSize()
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { measured.controlTextHeight = $0 }
            Text(verbatim: "X")
                .font(.footnote.weight(.semibold))
                .fixedSize()
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { measured.titleHeight = $0 }
        }
        .hidden()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
