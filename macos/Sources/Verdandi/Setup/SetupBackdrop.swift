import SwiftUI

/// A soft mesh of muted colours that drifts slowly, behind the setup card
/// and the About window: something for the glass above it to refract.
struct SetupBackdrop: View {
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var drifted = false

  var body: some View {
    MeshGradient(width: 3, height: 3, points: points, colors: colors, smoothsColors: true)
      .onAppear {
        guard !reduceMotion else { return }
        withAnimation(.easeInOut(duration: 10).repeatForever(autoreverses: true)) { drifted = true }
      }
      .accessibilityHidden(true)
  }

  private var points: [SIMD2<Float>] {
    let shift: Float = drifted ? 0.09 : -0.07
    return [
      [0, 0], [0.5 + shift, 0], [1, 0],
      [0, 0.5 - shift], [0.5 - shift * 0.8, 0.5 + shift * 0.6], [1, 0.5 + shift],
      [0, 1], [0.5 - shift, 1], [1, 1],
    ]
  }

  private var colors: [Color] {
    if colorScheme == .dark {
      return [
        Color(red: 0.10, green: 0.12, blue: 0.24), Color(red: 0.17, green: 0.13, blue: 0.29),
        Color(red: 0.09, green: 0.17, blue: 0.27),
        Color(red: 0.12, green: 0.21, blue: 0.30), Color(red: 0.22, green: 0.16, blue: 0.33),
        Color(red: 0.10, green: 0.23, blue: 0.27),
        Color(red: 0.16, green: 0.12, blue: 0.24), Color(red: 0.11, green: 0.19, blue: 0.30),
        Color(red: 0.08, green: 0.13, blue: 0.21),
      ]
    }
    return [
      Color(red: 0.86, green: 0.89, blue: 0.98), Color(red: 0.93, green: 0.87, blue: 0.96),
      Color(red: 0.85, green: 0.93, blue: 0.96),
      Color(red: 0.80, green: 0.88, blue: 0.97), Color(red: 0.96, green: 0.91, blue: 0.92),
      Color(red: 0.84, green: 0.94, blue: 0.91),
      Color(red: 0.95, green: 0.90, blue: 0.86), Color(red: 0.86, green: 0.87, blue: 0.97),
      Color(red: 0.90, green: 0.94, blue: 0.98),
    ]
  }
}
