import SwiftUI

/// The notices over the bottom of the window, newest last, as glass toasts:
/// each goes after a while unless the pointer rests on it, or when
/// dismissed. The same notice reported again counts up instead of stacking.
struct NoticesView: View {
  @Environment(AppModel.self) private var model
  /// At most this many show at once, the newest.
  static let shownAtOnce = 3

  var body: some View {
    GlassEffectContainer(spacing: 10) {
      VStack(spacing: 10) {
        ForEach(model.notices.suffix(Self.shownAtOnce)) { notice in
          NoticeToast(notice: notice)
            .transition(
              .asymmetric(
                insertion: .move(edge: .bottom).combined(with: .opacity),
                removal: .scale(scale: 0.9).combined(with: .opacity)))
        }
      }
    }
    .padding(.horizontal, 24)
    .padding(.bottom, 20)
    .animation(.spring(duration: 0.4, bounce: 0.2), value: model.notices)
  }
}

private struct NoticeToast: View {
  @Environment(AppModel.self) private var model
  var notice: Notice
  @State private var isHovered = false

  /// How long a notice shows after it was last reported, or after the
  /// pointer left it.
  static let shownFor = Duration.seconds(8)

  /// What restarts the time a notice shows.
  private struct Showing: Equatable {
    var reportedAt: Date
    var isHovered: Bool
  }

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: symbol)
        .font(.title3)
        .symbolRenderingMode(notice.kind == .problem ? .multicolor : .hierarchical)
        .foregroundStyle(tint)
        .symbolEffect(.bounce, value: notice.count)
        .frame(width: 24)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 6) {
          Text(notice.title).font(.headline)
          if notice.count > 1 {
            Text(verbatim: "×\(notice.count)")
              .font(.caption.weight(.semibold).monospacedDigit())
              .padding(.horizontal, 6)
              .padding(.vertical, 1)
              .background(.quaternary, in: .capsule)
              .contentTransition(.numericText(value: Double(notice.count)))
              .accessibilityLabel("\(notice.count) times")
          }
        }
        Text(notice.message)
          .font(.callout)
          .foregroundStyle(.secondary)
          .lineLimit(4)
          .textSelection(.enabled)
          .fixedSize(horizontal: false, vertical: true)
      }
      Spacer(minLength: 8)
      Button("Dismiss", systemImage: "xmark") { dismiss() }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .foregroundStyle(.secondary)
        .opacity(isHovered ? 1 : 0.55)
        .help("Dismiss")
    }
    .padding(.leading, 14)
    .padding(.trailing, 12)
    .padding(.vertical, 12)
    .frame(maxWidth: 480, alignment: .leading)
    .glassEffect(.regular, in: .rect(cornerRadius: 20))
    .onHover { isHovered = $0 }
    .animation(.snappy, value: notice.count)
    .accessibilityElement(children: .combine)
    .accessibilityAction(named: "Dismiss") { dismiss() }
    .task(id: Showing(reportedAt: notice.reportedAt, isHovered: isHovered)) {
      guard !isHovered else { return }
      try? await Task.sleep(for: Self.shownFor)
      guard !Task.isCancelled else { return }
      dismiss()
    }
    .onAppear {
      AccessibilityNotification.Announcement("\(notice.title). \(notice.message)").post()
    }
  }

  private var symbol: String {
    switch notice.kind {
    case .problem: "exclamationmark.triangle.fill"
    case .offline: "wifi.exclamationmark"
    case .rateLimited: "gauge.with.dots.needle.0percent"
    case .info: "info.circle.fill"
    }
  }

  private var tint: Color {
    switch notice.kind {
    case .problem, .rateLimited: .orange
    case .offline: .red
    case .info: .accentColor
    }
  }

  private func dismiss() {
    model.notices.removeAll { $0.id == notice.id }
  }
}
