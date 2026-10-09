import SwiftUI

/// Notices, briefly, over the top of the window, newest last, as glass
/// toasts. Each goes after a while, or as it is swiped away, and VoiceOver
/// reads it out as it comes.
struct NoticesOverlay: View {
    @Environment(AppModel.self) private var model
    /// At most this many show at once, the newest.
    static let shownAtOnce = 3

    var body: some View {
        GlassEffectContainer(spacing: 8) {
            VStack(spacing: 8) {
                ForEach(model.notices.suffix(Self.shownAtOnce)) { notice in
                    NoticeToast(notice: notice)
                        .transition(
                            .asymmetric(
                                insertion: .move(edge: .top).combined(with: .opacity),
                                removal: .scale(scale: 0.92).combined(with: .opacity)))
                }
            }
        }
        .frame(maxWidth: 560)
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .animation(.spring(duration: 0.4, bounce: 0.2), value: model.notices)
    }
}

/// One notice: its symbol and text on glass, gone when swiped up or aside.
private struct NoticeToast: View {
    @Environment(AppModel.self) private var model
    @Environment(\.palette) private var palette
    var notice: ShownNotice
    @State private var drag = CGSize.zero

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: notice.systemImage)
                .font(.body.weight(.semibold))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(palette.accent)
                .accessibilityHidden(true)
            Text(notice.text)
                .font(.callout)
                .foregroundStyle(.primary)
                .lineLimit(5)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .frame(minHeight: 48)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 24, style: .continuous))
        .offset(x: drag.width, y: min(drag.height, 0) + rubberBand(max(drag.height, 0)))
        .opacity(1 - min(max(abs(drag.width) / 240, -drag.height / 120), 0.6))
        .gesture(
            DragGesture(minimumDistance: 8)
                .onChanged { drag = $0.translation }
                .onEnded { value in
                    let end = value.predictedEndTranslation
                    if end.height < -50 || abs(end.width) > 140 {
                        dismiss()
                    } else {
                        withAnimation(.spring(duration: 0.3)) { drag = .zero }
                    }
                }
        )
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
        .accessibilityAction(named: "Dismiss") { dismiss() }
        .onAppear {
            AccessibilityNotification.Announcement(notice.text).post()
        }
    }

    /// Pulled down, it gives a little and no more.
    private func rubberBand(_ distance: CGFloat) -> CGFloat {
        12 * (1 - 1 / (distance / 40 + 1))
    }

    private func dismiss() {
        withAnimation(.snappy) { model.notices.removeAll { $0.id == notice.id } }
    }
}
