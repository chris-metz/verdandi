import SwiftUI

/// What shows while the core starts and the sign-in is checked: the icon,
/// and, if it takes a moment, what is happening, so that a quick start
/// does not flash a spinner.
struct StartingView: View {
    var message: String

    @State private var waited = false

    var body: some View {
        VStack(spacing: 24) {
            AppIconView(size: 96)
            HStack(spacing: 10) {
                ProgressView()
                Text(message)
                    .foregroundStyle(.secondary)
            }
            .font(.subheadline)
            .opacity(waited ? 1 : 0)
            .accessibilityHidden(!waited)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(uiColor: .systemBackground))
        .task {
            try? await Task.sleep(for: .milliseconds(600))
            withAnimation(.easeIn(duration: 0.3)) { waited = true }
        }
    }
}

/// Why Verdandi could not start, with the details to report it.
struct StartFailedView: View {
    var message: String

    static let newIssue = URL(string: "https://github.com/chris-metz/verdandi/issues/new")

    @State private var copied = false

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                AppIconView(size: 80)
                    .overlay(alignment: .bottomTrailing) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .font(.system(size: 30))
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(.white, .orange)
                            .background(Circle().fill(Color(uiColor: .systemBackground)).padding(-2))
                            .offset(x: 8, y: 8)
                            .accessibilityHidden(true)
                    }
                VStack(spacing: 8) {
                    Text("Verdandi Could Not Start")
                        .font(.title2.bold())
                        .multilineTextAlignment(.center)
                    Text(message)
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .textSelection(.enabled)
                }
                HStack(spacing: 10) {
                    Button(copied ? "Copied" : "Copy Details", systemImage: copied ? "checkmark" : "doc.on.doc") {
                        UIPasteboard.general.string = details
                        copied = true
                    }
                    .buttonStyle(.glass)
                    .contentTransition(.symbolEffect(.replace))
                    if let newIssue = Self.newIssue {
                        Link(destination: newIssue) {
                            Label("Report an Issue", systemImage: "arrow.up.forward")
                        }
                        .buttonStyle(.glassProminent)
                    }
                }
                .controlSize(.large)
            }
            .frame(maxWidth: 440)
            .padding(32)
            .frame(maxWidth: .infinity)
        }
        .defaultScrollAnchor(.center)
        .scrollBounceBehavior(.basedOnSize)
        .background(Color(uiColor: .systemBackground))
    }

    /// The message, with the app's version and the system's, as an issue
    /// needs them.
    private var details: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        let device = UIDevice.current
        return "Verdandi \(version) (\(build)) on \(device.systemName) \(device.systemVersion): \(message)"
    }
}
