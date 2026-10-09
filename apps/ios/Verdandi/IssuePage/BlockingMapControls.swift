import SwiftUI
import VerdandiKit

/// A side's end, past its last step: more to read further back or on, the
/// reading under way, which a tap stops, or fewer steps to show again. It
/// floats over the map as a control on glass, as the desktop's edge card
/// is a button, and says what a tap does, as the desktop's says.
struct BlockingMapEndControl: View {
    @Environment(\.palette) private var palette
    var side: BlockingSide
    var end: BlockingEnd
    var size: CGSize
    var activate: () -> Void

    var body: some View {
        Button(action: activate) {
            HStack(spacing: 10) {
                icon
                    .font(.body.weight(.semibold))
                    .foregroundStyle(palette.accent)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(palette.foreground)
                    if let subtitle {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundStyle(palette.muted)
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                Spacer(minLength: 0)
                if case .loading = end {
                    // A tap stops it.
                    Image(systemName: "stop.circle.fill")
                        .font(.title3)
                        .symbolRenderingMode(.hierarchical)
                        .foregroundStyle(palette.muted)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.roundedRectangle(radius: 18))
        .frame(width: size.width, height: size.height)
        .accessibilityLabel(accessibilityText)
        .accessibilityHint(hint)
        .help(hint)
    }

    @ViewBuilder private var icon: some View {
        switch end {
        case .loading:
            ProgressView().controlSize(.small)
        case .paused:
            Image(systemName: "play.fill")
        case .expanded:
            Image(systemName: inwards)
        default:
            Image(systemName: outwards)
        }
    }

    /// Chevrons away from the map's issue, and back towards it.
    private var outwards: String { side == .blockedBy ? "chevron.backward.2" : "chevron.forward.2" }
    private var inwards: String { side == .blockedBy ? "chevron.forward.2" : "chevron.backward.2" }

    private var further: String { side == .blockedBy ? "Further back" : "Further on" }

    private var title: String {
        switch end {
        case .folded(let count): "+\(count) more"
        case .expanded: "Fewer"
        case .paused: "Continue…"
        case .loading: "Loading…"
        case .unknown, .none: "More…"
        }
    }

    private var subtitle: String? {
        switch end {
        case .folded: further
        case .expanded: "Back to 2 steps"
        case .paused: "Paused"
        case .loading(let count): "\(count) so far"
        case .unknown, .none: "Total unknown"
        }
    }

    private var accessibilityText: String {
        let way = side == .blockedBy ? "further back" : "further on"
        return switch end {
        case .folded(let count): "\(count) more \(count == 1 ? "issue" : "issues") \(way)"
        case .expanded: "Fewer steps \(way)"
        case .paused: "Continue reading \(way)"
        case .loading(let count): "Loading \(way), \(count) \(count == 1 ? "issue" : "issues") so far"
        case .unknown, .none: "More \(way), how many is unknown"
        }
    }

    private var hint: String {
        switch end {
        case .loading: "Stops loading."
        case .expanded: "Shows two steps again."
        default: "Reads the blocking chain \(side == .blockedBy ? "further back" : "further on")."
        }
    }
}

/// A step's control for its cards beyond those it shows, or for showing
/// fewer again.
struct BlockingMapStepToggle: View {
    @Environment(\.palette) private var palette
    var hidden: Int
    var size: CGSize
    var toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            Label(
                hidden > 0 ? "+\(hidden) more" : "Show fewer",
                systemImage: hidden > 0 ? "chevron.down" : "chevron.up"
            )
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(palette.foreground)
            .lineLimit(1)
            .minimumScaleFactor(0.75)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.roundedRectangle(radius: 18))
        .frame(width: size.width, height: size.height)
        .accessibilityLabel(hidden > 0 ? "\(hidden) more in this step" : "Show fewer in this step")
    }
}
