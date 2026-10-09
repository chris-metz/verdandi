import SwiftUI

/// About Verdandi: the icon over the backdrop signing in has, the version,
/// what Verdandi is for, and where it lives.
struct AboutView: View {
    /// Where Verdandi lives.
    static let repository = URL(string: "https://github.com/chris-metz/verdandi")

    /// `0.1.0 (1)`, from the bundle.
    static var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "0.1.0"
        guard let build = info?["CFBundleVersion"] as? String else { return short }
        return "\(short) (\(build))"
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                AppIconView(size: 112)
                Text("Verdandi")
                    .font(.largeTitle.bold())
                    .padding(.top, 18)
                Text("Version \(Self.version)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .padding(.top, 2)
                Text("GitHub issues across many repositories, with their sub-issues and the issues that block them.")
                    .font(.body)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 18)
                if let repository = Self.repository {
                    GlassEffectContainer(spacing: 10) {
                        VStack(spacing: 10) {
                            Link(destination: repository) {
                                Label("Verdandi on GitHub", systemImage: "arrow.up.forward.square")
                                    .frame(maxWidth: 260)
                            }
                            .buttonStyle(.glassProminent)
                            Link(destination: repository.appending(path: "issues/new")) {
                                Label("Report an Issue", systemImage: "exclamationmark.bubble")
                                    .frame(maxWidth: 260)
                            }
                            .buttonStyle(.glass)
                        }
                    }
                    .controlSize(.large)
                    .padding(.top, 26)
                }
                Text("Verdandi is a personal project, shared in the open. There is no support or roadmap to rely on.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 28)
                Text("© 2026 Chris Metz")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
                    .padding(.top, 6)
            }
            .frame(maxWidth: 420)
            .padding(.horizontal, 28)
            .padding(.vertical, 36)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background { SignInBackdrop().ignoresSafeArea() }
        .navigationTitle("About")
        .navigationBarTitleDisplayMode(.inline)
    }
}
