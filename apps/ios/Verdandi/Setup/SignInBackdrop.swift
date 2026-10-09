import SwiftUI

/// A calm mesh in the icon's colours, navy, cream and a little gold, that
/// drifts slowly behind signing in and About: something for the glass above
/// it to refract.
struct SignInBackdrop: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drifted = false

    var body: some View {
        MeshGradient(width: 3, height: 3, points: points, colors: colors, smoothsColors: true)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 12).repeatForever(autoreverses: true)) { drifted = true }
            }
            .accessibilityHidden(true)
    }

    private var points: [SIMD2<Float>] {
        let shift: Float = drifted ? 0.08 : -0.06
        return [
            [0, 0], [0.5 + shift, 0], [1, 0],
            [0, 0.45 - shift], [0.5 - shift * 0.8, 0.5 + shift * 0.6], [1, 0.55 + shift],
            [0, 1], [0.5 - shift, 1], [1, 1],
        ]
    }

    private var colors: [Color] {
        if colorScheme == .dark {
            return [
                Color(red: 0.11, green: 0.16, blue: 0.28), Color(red: 0.13, green: 0.20, blue: 0.34),
                Color(red: 0.09, green: 0.14, blue: 0.26),
                Color(red: 0.07, green: 0.11, blue: 0.21), Color(red: 0.14, green: 0.18, blue: 0.30),
                Color(red: 0.10, green: 0.15, blue: 0.27),
                Color(red: 0.20, green: 0.16, blue: 0.13), Color(red: 0.07, green: 0.11, blue: 0.20),
                Color(red: 0.05, green: 0.09, blue: 0.17),
            ]
        }
        return [
            Color(red: 0.87, green: 0.90, blue: 0.97), Color(red: 0.95, green: 0.94, blue: 0.91),
            Color(red: 0.85, green: 0.89, blue: 0.97),
            Color(red: 0.91, green: 0.93, blue: 0.98), Color(red: 0.98, green: 0.95, blue: 0.89),
            Color(red: 0.89, green: 0.92, blue: 0.98),
            Color(red: 0.98, green: 0.92, blue: 0.81), Color(red: 0.90, green: 0.92, blue: 0.98),
            Color(red: 0.94, green: 0.93, blue: 0.90),
        ]
    }
}
