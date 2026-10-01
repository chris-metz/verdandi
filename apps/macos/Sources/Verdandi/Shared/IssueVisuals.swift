import SwiftUI
import VerdandiCore

extension Color {
  /// A colour from six hex digits, as GitHub gives labels.
  init(hex: String) {
    let value = UInt32(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0x888888
    self.init(
      .sRGB,
      red: Double((value >> 16) & 0xFF) / 255,
      green: Double((value >> 8) & 0xFF) / 255,
      blue: Double(value & 0xFF) / 255
    )
  }

  /// GitHub's colours for an issue's state.
  static func issueState(_ state: IssueState, reason: StateReason? = nil) -> Color {
    switch (state, reason) {
    case (.open, _): Color(red: 0.12, green: 0.65, blue: 0.29)
    case (.closed, .notPlanned), (.closed, .duplicate): .secondary
    case (.closed, _): Color(red: 0.51, green: 0.31, blue: 0.87)
    }
  }
}

/// The open or closed icon of an issue, in GitHub's colours.
struct IssueStateIcon: View {
  var state: IssueState
  var reason: StateReason? = nil

  var body: some View {
    Image(systemName: symbol)
      .foregroundStyle(Color.issueState(state, reason: reason))
      .accessibilityLabel(state == .open ? "Open" : "Closed")
  }

  private var symbol: String {
    switch (state, reason) {
    case (.open, _): "circle.circle"
    case (.closed, .notPlanned), (.closed, .duplicate): "slash.circle"
    case (.closed, _): "checkmark.circle"
    }
  }
}

/// A label as GitHub colours it: its colour as a tint behind its name.
struct LabelChip: View {
  var label: VerdandiCore.Label
  var size: ControlSize = .regular

  var body: some View {
    let color = Color(hex: label.color)
    Text(label.name)
      .font(size == .small ? .caption2 : .caption)
      .fontWeight(.medium)
      .lineLimit(1)
      .padding(.horizontal, size == .small ? 6 : 8)
      .padding(.vertical, size == .small ? 1 : 2)
      .foregroundStyle(color.mix(with: .primary, by: 0.35))
      .background(color.opacity(0.18), in: Capsule())
      .overlay(Capsule().strokeBorder(color.opacity(0.45), lineWidth: 0.5))
  }
}

/// An account's avatar, round.
struct AvatarView: View {
  var actor: Actor?
  var size: CGFloat = 20

  var body: some View {
    AsyncImage(url: actor?.avatarURL) { image in
      image.resizable().scaledToFill()
    } placeholder: {
      Image(systemName: "person.crop.circle.fill").resizable().foregroundStyle(.tertiary)
    }
    .frame(width: size, height: size)
    .clipShape(Circle())
    .accessibilityHidden(true)
  }
}
