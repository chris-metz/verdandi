import SwiftUI

/// Verdandi's icon, drawn as `apps/desktop/build/icon.svg` draws it: two
/// issues blocking a third, cream on navy, the blocked one gold. Drawn
/// rather than taken from the app icon, so that it is sharp at any size.
struct AppIconView: View {
    var size: CGFloat = 96
    @Environment(\.colorScheme) private var colorScheme

    /// The icon's colours, which the screens around it take up too.
    static let navyTop = Color(red: 0x22 / 255, green: 0x34 / 255, blue: 0x5a / 255)
    static let navyBottom = Color(red: 0x0f / 255, green: 0x1a / 255, blue: 0x2f / 255)
    static let cream = Color(red: 0xef / 255, green: 0xe9 / 255, blue: 0xda / 255)
    static let goldLight = Color(red: 0xf6 / 255, green: 0xcc / 255, blue: 0x6e / 255)
    static let gold = Color(red: 0xd6 / 255, green: 0x91 / 255, blue: 0x2a / 255)

    var body: some View {
        Canvas { context, canvas in
            // The SVG's square is 824 wide, from 100 to 924.
            let scale = canvas.width / 824
            func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: (x - 100) * scale, y: (y - 100) * scale) }
            func circle(_ x: CGFloat, _ y: CGFloat, _ radius: CGFloat) -> Path {
                let center = point(x, y)
                return Path(
                    ellipseIn: CGRect(
                        x: center.x - radius * scale, y: center.y - radius * scale, width: 2 * radius * scale,
                        height: 2 * radius * scale))
            }

            let square = Path(roundedRect: CGRect(origin: .zero, size: canvas), cornerRadius: 185 * scale, style: .continuous)
            context.fill(
                square,
                with: .linearGradient(
                    Gradient(colors: [Self.navyTop, Self.navyBottom]), startPoint: .zero,
                    endPoint: CGPoint(x: 0, y: canvas.height)))

            context.drawLayer { layer in
                layer.addFilter(.shadow(color: .black.opacity(0.35), radius: 16 * scale, x: 0, y: 14 * scale))
                var edges = Path()
                edges.move(to: point(322, 330))
                edges.addLine(to: point(512, 675))
                edges.addLine(to: point(702, 330))
                layer.stroke(edges, with: .color(Self.cream), style: StrokeStyle(lineWidth: 84 * scale, lineCap: .round, lineJoin: .round))
                layer.fill(circle(322, 330, 94), with: .color(Self.cream))
                layer.fill(circle(702, 330, 94), with: .color(Self.cream))
                // The gradient's centre sits up and left in the circle's box,
                // as a light from above would put it.
                layer.fill(
                    circle(512, 675, 116),
                    with: .radialGradient(
                        Gradient(colors: [Self.goldLight, Self.gold]),
                        center: point(396 + 0.38 * 232, 559 + 0.32 * 232), startRadius: 0, endRadius: 0.75 * 232 * scale))
            }
        }
        .frame(width: size, height: size)
        .overlay {
            // A faint edge, so that the navy holds against a dark ground.
            if colorScheme == .dark {
                RoundedRectangle(cornerRadius: size * 185 / 824, style: .continuous)
                    .strokeBorder(.white.opacity(0.16), lineWidth: max(size / 120, 0.5))
            }
        }
        .shadow(color: .black.opacity(colorScheme == .dark ? 0.4 : 0.18), radius: size / 8, y: size / 14)
        .accessibilityHidden(true)
    }
}

#Preview {
    AppIconView(size: 180).padding(40)
}
