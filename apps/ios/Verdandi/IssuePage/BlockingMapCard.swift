import SwiftUI
import VerdandiKit

/// How a card last changed as the map loaded: it came in, or moved to
/// another step. `token` tells one change from the next.
struct BlockingMapFlash: Equatable {
    var moved: Bool
    var token: Int
}

/// An issue on the map, as the desktop draws it: its state and reference
/// above, its title, and its labels as dots. The map's issue stands out in
/// the accent; a closed issue fades; an external one has a dashed edge; an
/// open issue that something open blocks has a red edge on its leading
/// side. Badges on its sides say what lies beyond it that the map does not
/// show.
struct BlockingMapCard: View {
    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var card: BlockingMap.Card
    var isRoot: Bool
    /// The map's issue's repository, whose issues need no `owner/name`.
    var rootRepository: RepositoryAddress?
    var size: CGSize
    var flash: BlockingMapFlash?

    @State private var flashOpacity = 0.0

    var body: some View {
        let issue = card.issue
        let shape = RoundedRectangle(cornerRadius: BlockingMapMetrics.Card.cornerRadius, style: .continuous)
        VStack(alignment: .leading, spacing: BlockingMapMetrics.Card.spacing) {
            header
            Text(issue.title)
                .font(.subheadline.weight(isRoot ? .semibold : .regular))
                .foregroundStyle(palette.foreground)
                .lineLimit(BlockingMapMetrics.titleLines)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                // Before the room below it, which only fills the card.
                .layoutPriority(1)
            labels
                .frame(maxHeight: .infinity, alignment: .bottomLeading)
        }
        .padding(.horizontal, BlockingMapMetrics.Card.horizontalPadding)
        .padding(.vertical, BlockingMapMetrics.Card.verticalPadding)
        .frame(width: size.width, height: size.height, alignment: .topLeading)
        // A closed issue fades, but stays solid over the arrows behind it.
        .opacity(issue.state == .closed && !isRoot ? 0.55 : 1)
        .background {
            shape.fill(palette.card)
            if isRoot { shape.fill(palette.accent.opacity(0.09)) }
        }
        .overlay(alignment: .leading) {
            if isBlocked { palette.blocked.frame(width: 3) }
        }
        .clipShape(shape)
        .overlay { border(shape) }
        .overlay {
            shape.fill(flashColor).opacity(flashOpacity).allowsHitTesting(false)
        }
        .compositingGroup()
        .shadow(color: .black.opacity(isRoot ? 0.12 : 0.06), radius: isRoot ? 6 : 3, y: isRoot ? 2 : 1)
        .contentShape(.hoverEffect, shape)
        .contentShape(.contextMenuPreview, shape)
        .contentShape(shape)
        .task(id: flash?.token) {
            guard flash != nil, !reduceMotion else { return }
            flashOpacity = 1
            try? await Task.sleep(for: .milliseconds(40))
            withAnimation(.easeOut(duration: 1.8)) { flashOpacity = 0 }
        }
    }

    private var header: some View {
        let issue = card.issue
        return HStack(spacing: 5) {
            StateIcon(state: issue.state, reason: issue.stateReason)
                .font(.caption)
            if let repository = otherRepository {
                Text(repository.nameWithOwner)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background {
                        if issue.external {
                            Capsule().strokeBorder(palette.border)
                        } else {
                            Capsule().fill(palette.muted.opacity(0.12))
                        }
                    }
            }
            if issue.external {
                Image(systemName: "arrow.up.forward.square")
                    .font(.caption2)
                    .foregroundStyle(palette.muted)
                    .accessibilityHidden(true)
            }
            Spacer(minLength: 4)
            Text(verbatim: "#\(issue.number.map(String.init) ?? "")")
                .font(.caption.monospacedDigit())
                .foregroundStyle(palette.muted)
                .lineLimit(1)
                .fixedSize()
        }
    }

    @ViewBuilder private var labels: some View {
        let labels = card.issue.labels ?? []
        let shown = 8
        HStack(spacing: 4) {
            ForEach(labels.prefix(shown)) { label in
                Circle()
                    .fill(label.swatch)
                    .overlay { Circle().strokeBorder(palette.foreground.opacity(0.12), lineWidth: 0.5) }
                    .frame(width: BlockingMapMetrics.Card.labelsHeight, height: BlockingMapMetrics.Card.labelsHeight)
            }
            if labels.count > shown {
                Text(verbatim: "+\(labels.count - shown)")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(palette.muted)
            }
        }
        .frame(height: BlockingMapMetrics.Card.labelsHeight)
        .accessibilityHidden(true)
    }

    private func border(_ shape: RoundedRectangle) -> some View {
        Group {
            if isRoot {
                shape.strokeBorder(palette.accent, lineWidth: 2)
            } else if card.issue.external {
                shape.strokeBorder(palette.border, style: StrokeStyle(lineWidth: 1.2, dash: [5, 3]))
            } else {
                shape.strokeBorder(palette.border, lineWidth: 1)
            }
        }
    }

    /// Its repository, when it is not the map's issue's.
    private var otherRepository: RepositoryAddress? {
        let repository = card.issue.repository
        guard card.issue.external || rootRepository.map({ !$0.sameRepository(as: repository) }) ?? false else {
            return nil
        }
        return repository
    }

    /// Open, and waiting on something open.
    private var isBlocked: Bool {
        card.issue.state == .open && (card.issue.blockedBy?.open ?? 0) > 0
    }

    private var flashColor: Color {
        flash?.moved == true ? palette.mapMoved : palette.mapNew
    }
}

/// What lies beyond a card on one side that the map does not show: issues
/// not read yet, or not visible to this account; a closed issue's, which
/// are not followed; those being read, or waiting for the rate limit; or a
/// read that failed, which a tap tries again.
struct BlockingMapBadge: View {
    @Environment(\.palette) private var palette
    var badge: BlockingBadge
    var side: BlockingSide
    var retry: () -> Void

    var body: some View {
        if case .failed(let problem) = badge {
            Button(action: retry) {
                Label("Retry", systemImage: "arrow.clockwise")
                    .labelStyle(CompactLabelStyle())
                    .foregroundStyle(palette.blocked)
                    .modifier(BadgeFace(stroke: palette.blocked.opacity(0.5)))
            }
            .buttonStyle(.plain)
            .contentShape(.rect.inset(by: -10))
            .hoverEffect(.highlight)
            .help(problem.message)
            .accessibilityLabel(side == .blockedBy ? "Retry its blockers" : "Retry the issues it blocks")
            .accessibilityHint(problem.message)
        } else {
            face
                .foregroundStyle(palette.muted)
                .modifier(BadgeFace(stroke: palette.border))
                .help(label)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(label)
        }
    }

    @ViewBuilder private var face: some View {
        switch badge {
        case .unloaded(let count):
            Text(verbatim: "+\(count)")
        case .closed:
            Image(systemName: "ellipsis")
        case .loading:
            ProgressView().controlSize(.mini)
        case .paused:
            Image(systemName: "pause.fill")
        case .inaccessible(let count):
            Label("\(count)", systemImage: "lock.fill").labelStyle(CompactLabelStyle())
        case .failed:
            EmptyView()
        }
    }

    /// What it says to VoiceOver, and on hover.
    private var label: String {
        let others = side == .blockedBy ? "blockers" : "issues it blocks"
        switch badge {
        case .unloaded(let count):
            let one = side == .blockedBy ? "blocker" : "issue it blocks"
            return "\(count) more \(count == 1 ? one : others) not loaded"
        case .closed: return "Closed, so what lies beyond it is not followed"
        case .loading: return "Loading its \(others)"
        case .paused: return "Waiting for GitHub's rate limit to reset"
        case .inaccessible(let count): return "\(count) of its \(others) not visible to this account"
        case .failed(let problem): return problem.message
        }
    }

    /// Where it sits on its card: on the top corner of its side, standing
    /// out, as on the desktop.
    static func placement(of side: BlockingSide) -> (Alignment, CGSize) {
        side == .blockedBy ? (.topLeading, CGSize(width: -8, height: -9)) : (.topTrailing, CGSize(width: 8, height: -9))
    }
}

/// A badge's small capsule.
private struct BadgeFace: ViewModifier {
    @Environment(\.palette) private var palette
    var stroke: Color

    func body(content: Content) -> some View {
        content
            .font(.caption2.weight(.semibold).monospacedDigit())
            .padding(.horizontal, 6)
            .frame(minWidth: 22, minHeight: 18)
            .background(palette.card, in: .capsule)
            .overlay { Capsule().strokeBorder(stroke) }
    }
}
