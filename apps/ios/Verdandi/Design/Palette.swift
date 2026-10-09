import SwiftUI
import VerdandiKit

/// The colours of the theme shown: the user's light or dark theme from
/// `config.toml`, as the desktop app shows it. Everything that means
/// something in Verdandi takes its colour from here: open and closed,
/// blocked by and blocking, what could not be read.
///
/// The surfaces stay the system's, so that Liquid Glass reads as it should;
/// `background` tints the main area, as the desktop's does.
struct Palette: Equatable {
    var theme: Theme?

    private func color(_ token: String, _ fallback: Color) -> Color {
        theme?.colors[token].flatMap(Color.init(hex:)) ?? fallback
    }

    var background: Color { color("background", Color(uiColor: .systemBackground)) }
    var foreground: Color { color("foreground", .primary) }
    var muted: Color { color("muted-foreground", .secondary) }
    var border: Color { color("border", Color(uiColor: .separator)) }
    var card: Color { color("card", Color(uiColor: .secondarySystemBackground)) }
    var accent: Color { color("sidebar-primary", .accentColor) }
    var primary: Color { color("primary", .accentColor) }

    /// An open issue's icon.
    var open: Color { color("issue-open", .green) }
    /// A closed issue's icon.
    var closed: Color { color("issue-closed", .purple) }
    /// "Blocked by", in red.
    var blocked: Color { color("blocked", .red) }
    var blockedSurface: Color { color("blocked-surface", .red.opacity(0.12)) }
    /// "Blocks", in amber.
    var blocking: Color { color("blocking", .orange) }
    /// What could not be read, or is shown from before.
    var warning: Color { color("warning", .yellow) }
    var destructive: Color { color("destructive", .red) }
    /// The blocking map's flash over a card that has just come in.
    var mapNew: Color { color("map-new", .green.opacity(0.4)) }
    /// The blocking map's flash over a card that has moved to another step.
    var mapMoved: Color { color("map-moved", .yellow.opacity(0.4)) }

    /// An issue's state colour.
    func state(_ state: IssueState) -> Color { state == .open ? open : closed }

    /// Every token as CSS custom properties, for issue bodies in a web view.
    var cssVariables: String {
        guard let theme else { return "" }
        return theme.colors.map { "--\($0.key): \($0.value);" }.sorted().joined(separator: " ")
    }
}

extension EnvironmentValues {
    @Entry var palette = Palette()
}

extension Color {
    /// `#rrggbb` or `#rrggbbaa`, or six digits without `#`, as GitHub gives
    /// a label's colour.
    init?(hex: String) {
        var digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        if digits.count == 3 { digits = digits.map { "\($0)\($0)" }.joined() }
        guard digits.count == 6 || digits.count == 8, let value = UInt64(digits, radix: 16) else { return nil }
        let hasAlpha = digits.count == 8
        let red = Double((value >> (hasAlpha ? 24 : 16)) & 0xff) / 255
        let green = Double((value >> (hasAlpha ? 16 : 8)) & 0xff) / 255
        let blue = Double((value >> (hasAlpha ? 8 : 0)) & 0xff) / 255
        let alpha = hasAlpha ? Double(value & 0xff) / 255 : 1
        self.init(.sRGB, red: red, green: green, blue: blue, opacity: alpha)
    }
}

extension IssueLabel {
    /// GitHub's colour for the label.
    var swatch: Color { Color(hex: color) ?? .gray }

    /// Whether its name reads better in dark text on its colour.
    var prefersDarkText: Bool {
        guard let value = UInt64(color, radix: 16) else { return false }
        let red = Double((value >> 16) & 0xff), green = Double((value >> 8) & 0xff), blue = Double(value & 0xff)
        return (0.299 * red + 0.587 * green + 0.114 * blue) / 255 > 0.6
    }
}
