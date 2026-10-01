import SwiftUI

/// The tabs of the Settings window.
enum SettingsTab: String, Hashable {
  case general
  case github
}

/// The Settings window (⌘,): General and GitHub, each a grouped form as
/// macOS's own settings are. Every choice applies at once.
struct SettingsView: View {
  @State private var tab = LaunchOptions.settingsTab ?? .general

  var body: some View {
    TabView(selection: $tab) {
      Tab("General", systemImage: "gearshape", value: .general) {
        GeneralSettingsView()
      }
      Tab("GitHub", systemImage: "person.crop.circle", value: .github) {
        GitHubSettingsView()
      }
    }
    .scenePadding(.minimum, edges: .top)
    .frame(width: 540)
    .background(WindowNumberReporter(role: "settings"))
  }
}
