import SwiftUI

/// Settings › General: the appearance, and the history of Go to Issue.
struct GeneralSettingsView: View {
  @AppStorage(Appearance.key) private var appearance = Appearance.system
  @AppStorage(RecentIssues.key) private var recentIssues: Data?

  var body: some View {
    Form {
      Section {
        LabeledContent("Appearance") {
          HStack(spacing: 14) {
            ForEach(Appearance.allCases) { choice in
              AppearanceChoice(appearance: choice, isSelected: choice == appearance) {
                appearance = choice
              }
            }
          }
        }
      } footer: {
        Text("Automatic follows the appearance of macOS.")
          .font(.caption)
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
      }

      Section("Go to Issue") {
        LabeledContent("Recent issues") {
          Button("Clear History") { recentIssues = nil }
            .disabled(recentIssues == nil)
        }
      }
    }
    .formStyle(.grouped)
    .scrollDisabled(true)
    .padding(.bottom, 12)
    .fixedSize(horizontal: false, vertical: true)
    .onChange(of: appearance) { appearance.apply() }
  }
}

/// One appearance to choose, as a little window on a desktop, the way
/// System Settings shows them.
private struct AppearanceChoice: View {
  var appearance: Appearance
  var isSelected: Bool
  var choose: () -> Void

  var body: some View {
    Button(action: choose) {
      VStack(spacing: 6) {
        AppearancePreview(appearance: appearance)
          .frame(width: 72, height: 48)
          .clipShape(.rect(cornerRadius: 8))
          .overlay {
            RoundedRectangle(cornerRadius: 8).strokeBorder(.separator, lineWidth: 0.5)
          }
          .padding(3)
          .overlay {
            RoundedRectangle(cornerRadius: 11)
              .strokeBorder(Color.accentColor, lineWidth: 3)
              .opacity(isSelected ? 1 : 0)
          }
        Text(appearance.title)
          .font(.caption)
          .fontWeight(isSelected ? .semibold : .regular)
          .foregroundStyle(isSelected ? .primary : .secondary)
      }
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(appearance.title)
    .accessibilityAddTraits(isSelected ? .isSelected : [])
    .animation(.snappy, value: isSelected)
  }
}

/// A desktop with a window in an appearance; Automatic shows light and
/// dark halves.
private struct AppearancePreview: View {
  var appearance: Appearance

  var body: some View {
    switch appearance {
    case .light: MiniDesktop(dark: false)
    case .dark: MiniDesktop(dark: true)
    case .system:
      MiniDesktop(dark: false)
        .overlay { MiniDesktop(dark: true).mask(DiagonalHalf()) }
    }
  }
}

private struct MiniDesktop: View {
  var dark: Bool

  var body: some View {
    let wallpaper =
      dark
      ? [Color(red: 0.13, green: 0.16, blue: 0.32), Color(red: 0.30, green: 0.18, blue: 0.40)]
      : [Color(red: 0.62, green: 0.76, blue: 0.97), Color(red: 0.88, green: 0.76, blue: 0.93)]
    let window = dark ? Color(white: 0.17) : Color(white: 0.98)
    let sidebar = dark ? Color(white: 0.25) : Color(white: 0.89)
    let line = dark ? Color(white: 0.42) : Color(white: 0.80)
    LinearGradient(colors: wallpaper, startPoint: .topLeading, endPoint: .bottomTrailing)
      .overlay(alignment: .topLeading) {
        HStack(spacing: 0) {
          VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 2) {
              ForEach([Color.red, .yellow, .green], id: \.self) { Circle().fill($0).frame(width: 3, height: 3) }
            }
            .padding(.bottom, 2)
            ForEach(0..<3, id: \.self) { _ in Capsule().fill(line).frame(width: 12, height: 2.5) }
          }
          .padding(4)
          .frame(maxHeight: .infinity, alignment: .top)
          .background(sidebar)
          VStack(alignment: .leading, spacing: 4) {
            Capsule().fill(Color.accentColor).frame(width: 22, height: 3)
            ForEach([28, 20, 24], id: \.self) { Capsule().fill(line).frame(width: CGFloat($0), height: 2.5) }
          }
          .padding(5)
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
          .background(window)
        }
        .clipShape(.rect(cornerRadius: 4))
        .padding(.leading, 8)
        .padding(.top, 8)
        .offset(x: 0, y: 0)
        .shadow(color: .black.opacity(0.18), radius: 2, y: 1)
      }
  }
}

/// The lower right half of a rectangle, cut along its diagonal.
nonisolated private struct DiagonalHalf: Shape {
  func path(in rect: CGRect) -> Path {
    Path { path in
      path.move(to: CGPoint(x: rect.maxX, y: rect.minY))
      path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
      path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
      path.closeSubpath()
    }
  }
}
