import SwiftUI
import VerdandiKit

@main
struct VerdandiApp: App {
    @State private var model = AppModel(credentials: LaunchOptions.current.makeCredentials())
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .task { await model.start() }
        }
        .onChange(of: scenePhase) { _, phase in
            // Back in front, what is old or failed is read again.
            if phase == .active { Task { await model.revalidate() } }
        }
        .commands { AppCommands(model: model) }
    }
}
