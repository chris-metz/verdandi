import SwiftUI
import VerdandiKit

/// Settings: the account GitHub is read as, the appearance and the themes,
/// what in `config.toml` Verdandi cannot use, and About. Each choice is
/// written to `config.toml` at once, as on the desktop, and the sheet
/// follows the file as the core pushes it.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var path: [Page] = []
    /// Why the last choice was not written, until another is made.
    @State private var error: String?

    enum Page: Hashable { case about }

    var body: some View {
        NavigationStack(path: $path) {
            Form {
                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                    }
                }
                AccountSection()
                appearance
                themes(.light)
                themes(.dark)
                problems
                Section {
                    NavigationLink(value: Page.about) {
                        LabeledContent("About Verdandi", value: AboutView.version)
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { dismiss() }
                }
            }
            .navigationDestination(for: Page.self) { _ in AboutView() }
        }
        .onAppear {
            if model.launch.settingsPage == "about", path.isEmpty { path = [.about] }
        }
    }

    private var config: ConfigState? { model.config }

    /// While `config.toml` cannot be read, nothing in it can be changed.
    private var unchangeable: Bool { config == nil || config?.status == .unreadable }

    // MARK: Appearance

    private var appearance: some View {
        Section {
            Picker(
                "Appearance",
                selection: Binding(
                    get: { config?.config.appearance ?? .system },
                    set: { appearance in choose(ConfigChange(appearance: appearance)) { $0.appearance = appearance } })
            ) {
                Text("System").tag(Appearance.system)
                Text("Light").tag(Appearance.light)
                Text("Dark").tag(Appearance.dark)
            }
            .pickerStyle(.segmented)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
            .disabled(unchangeable)
        } header: {
            Text("Appearance")
        } footer: {
            Text(
                "System follows this \(UIDevice.current.model)’s appearance. Text follows the size set in the Settings app, under Display & Brightness › Text Size."
            )
        }
    }

    // MARK: Themes

    private func themes(_ kind: Theme.Kind) -> some View {
        let chosen = kind == .light ? config?.config.lightTheme : config?.config.darkTheme
        return Section(kind == .light ? "Light Theme" : "Dark Theme") {
            ThemeGrid(themes: model.themes.filter { $0.kind == kind }, chosen: chosen ?? "") { id in
                if kind == .light {
                    choose(ConfigChange(lightTheme: id)) { $0.lightTheme = id }
                } else {
                    choose(ConfigChange(darkTheme: id)) { $0.darkTheme = id }
                }
            }
            .disabled(unchangeable)
            .listRowInsets(EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
        }
    }

    // MARK: Problems in config.toml

    @ViewBuilder private var problems: some View {
        if let config, !config.problems.isEmpty {
            Section {
                ForEach(Array(config.problems.enumerated()), id: \.offset) { _, problem in
                    Label {
                        Text(problem.message)
                            .fixedSize(horizontal: false, vertical: true)
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                    }
                    .font(.subheadline)
                }
            } header: {
                Text("config.toml")
            } footer: {
                Text(
                    config.status == .unreadable
                        ? "These settings cannot be changed until config.toml is fixed."
                        : "Until config.toml is fixed, Verdandi uses its defaults for these. A choice here replaces what it cannot use."
                )
            }
        }
    }

    // MARK: Choosing

    /// Writes a change to `config.toml`, showing it at once; the core's push
    /// confirms it, and a failure reads the file again and says why.
    private func choose(_ change: ConfigChange, showing apply: (inout Config) -> Void) {
        guard let core = model.core else { return }
        error = nil
        if var shown = model.config {
            apply(&shown.config)
            model.config = shown
        }
        Task {
            var message: String?
            do {
                let result = try await core.changeConfig(change)
                if !result.ok { message = result.message ?? "The change could not be written to config.toml." }
            } catch {
                message = error.localizedDescription
            }
            guard let message else { return }
            self.error = message
            await model.attempt { model.config = try await core.getConfig() }
        }
    }
}

/// The account GitHub is read as, where its token comes from, and signing
/// out, which the environment's token does not allow.
private struct AccountSection: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var confirmingSignOut = false

    var body: some View {
        Section {
            switch model.setup {
            case .ready(.known(let account, let source)):
                accountRow(login: account.login, detail: "Signed in to github.com")
                LabeledContent("Token", value: describe(source))
            case .ready(.unconfirmed(let message)):
                accountRow(login: nil, detail: "GitHub could not confirm the account: \(message)")
                if let source = model.credentials.current?.source {
                    LabeledContent("Token", value: describe(source))
                }
            case .checking:
                HStack(spacing: 12) {
                    ProgressView()
                    Text("Checking your GitHub sign-in…").foregroundStyle(.secondary)
                }
            case .blocked:
                accountRow(login: nil, detail: "Not signed in")
            }
            if signedIn {
                Button("Sign Out", role: .destructive) { confirmingSignOut = true }
                    .disabled(model.credentials.fromEnvironment)
                    .confirmationDialog(
                        "Sign out of GitHub?", isPresented: $confirmingSignOut, titleVisibility: .visible
                    ) {
                        Button("Sign Out", role: .destructive) {
                            // Signing in takes the window, without Settings over it.
                            dismiss()
                            Task { await model.signOut() }
                        }
                    } message: {
                        Text("Verdandi forgets the token on this \(UIDevice.current.model). Your repositories and views stay.")
                    }
            }
        } header: {
            Text("GitHub Account")
        } footer: {
            if let source = model.credentials.current?.source, model.credentials.fromEnvironment {
                Text(
                    "Verdandi was launched with \(source.rawValue) set, which signing out cannot remove. Launch it without \(source.rawValue) to sign out."
                )
            }
        }
    }

    private var signedIn: Bool {
        if case .ready = model.setup { return true }
        return false
    }

    private func accountRow(login: String?, detail: String) -> some View {
        HStack(spacing: 14) {
            AsyncImage(url: login.flatMap { URL(string: "https://github.com/\($0).png?size=120") }) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Image(systemName: "person.crop.circle.fill")
                    .resizable()
                    .foregroundStyle(.tertiary)
            }
            .frame(width: 52, height: 52)
            .clipShape(.circle)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                if let login {
                    Text("@\(login)").font(.headline)
                }
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private func describe(_ source: TokenSource) -> String {
        switch source {
        case .stored: "In this \(UIDevice.current.model)’s Keychain"
        case .ghToken, .githubToken: "From \(source.rawValue)"
        }
    }
}

/// A grid of tiles, one per theme of a kind, the chosen one marked.
private struct ThemeGrid: View {
    var themes: [Theme]
    var chosen: String
    var choose: (String) -> Void
    @ScaledMetric(relativeTo: .caption) private var tileWidth: CGFloat = 96

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: tileWidth, maximum: tileWidth * 1.6), spacing: 12)], spacing: 14) {
            ForEach(themes) { theme in
                Button {
                    choose(theme.id)
                } label: {
                    ThemeTile(theme: theme, chosen: theme.id == chosen)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(theme.name)
                .accessibilityAddTraits(theme.id == chosen ? [.isSelected] : [])
            }
        }
        .sensoryFeedback(.selection, trigger: chosen)
    }
}

/// A theme in miniature, as the desktop's settings draw it: a sidebar
/// strip beside the background, two lines of text, and an open, a closed
/// and a blocked dot, with its name below.
private struct ThemeTile: View {
    var theme: Theme
    var chosen: Bool
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(spacing: 6) {
            miniature
                .padding(3)
                .overlay {
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .strokeBorder(palette.accent, lineWidth: 2.5)
                        .opacity(chosen ? 1 : 0)
                }
            HStack(spacing: 3) {
                if chosen {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(palette.accent)
                }
                Text(theme.name)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            }
            .font(.caption.weight(chosen ? .semibold : .regular))
            .foregroundStyle(chosen ? .primary : .secondary)
        }
        .contentShape(.rect)
        .animation(.snappy, value: chosen)
    }

    private func color(_ token: String) -> Color {
        theme.colors[token].flatMap(Color.init(hex:)) ?? .gray
    }

    private var miniature: some View {
        HStack(spacing: 0) {
            Rectangle()
                .fill(color("sidebar"))
                .frame(width: 18)
                .overlay(alignment: .trailing) {
                    Rectangle().fill(color("sidebar-border")).frame(width: 1)
                }
            VStack(alignment: .leading, spacing: 5) {
                Capsule().fill(color("foreground")).frame(height: 4).frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.trailing, 8)
                Capsule().fill(color("muted-foreground")).frame(width: 26, height: 4)
                HStack(spacing: 4) {
                    ForEach(["issue-open", "issue-closed", "blocked"], id: \.self) { token in
                        Circle().fill(color(token)).frame(width: 6, height: 6)
                    }
                }
                .padding(.top, 2)
            }
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
        .frame(height: 58)
        .background(color("background"))
        .clipShape(.rect(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(color("border"), lineWidth: 1)
        }
        .accessibilityHidden(true)
    }
}
