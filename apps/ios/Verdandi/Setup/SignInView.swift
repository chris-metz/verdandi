import SwiftUI
import VerdandiKit

/// Signing in to GitHub, until the app has a token GitHub accepts: the icon
/// and what Verdandi is over a calm backdrop, then the ways in. **Sign In
/// with GitHub** shows a code to enter on github.com, when this build has
/// an OAuth App's client ID; a personal access token works always. It holds
/// still while GitHub checks a token, and says why GitHub rejected one.
struct SignInView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.colorScheme) private var colorScheme
    let problem: SetupProblem

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                card
                    .frame(maxWidth: 460)
                    .padding(.horizontal, regular ? 44 : 24)
                    .padding(.vertical, regular ? 44 : 32)
                    .background {
                        if regular {
                            // In the dark, more of the navy shows through.
                            RoundedRectangle(cornerRadius: 44, style: .continuous)
                                .fill(Color(uiColor: .systemBackground).opacity(colorScheme == .dark ? 0.55 : 0.82))
                                .shadow(color: .black.opacity(0.12), radius: 40, y: 18)
                        }
                    }
                    .padding(regular ? 32 : 0)
                    .frame(maxWidth: .infinity, minHeight: proxy.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
        }
        .background { SignInBackdrop().ignoresSafeArea() }
    }

    private var regular: Bool { sizeClass == .regular }

    private var card: some View {
        VStack(spacing: 28) {
            header
            if let callout = ProblemCallout(problem) {
                callout.transition(.opacity.combined(with: .scale(scale: 0.97)))
            }
            if problem.signingInHelps {
                SignInOptions(rejected: problem.isRejection)
                Label(
                    "Your token stays in this \(UIDevice.current.model)’s Keychain, and goes only to GitHub.",
                    systemImage: "lock.fill"
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .labelStyle(CenteredLabelStyle())
            } else {
                CheckAgainButton()
            }
        }
        .animation(.smooth(duration: 0.35), value: problem)
    }

    private var header: some View {
        VStack(spacing: 14) {
            AppIconView(size: 88)
                .padding(.bottom, 6)
            Text(welcomesBack ? "Welcome Back to Verdandi" : "Welcome to Verdandi")
                .font(.largeTitle.bold())
                .multilineTextAlignment(.center)
            Text("Your GitHub issues across many repositories, with their sub-issues and what blocks them.")
                .font(.title3)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
    }

    /// Whether the user has used Verdandi here before: it tracks
    /// repositories, or GitHub rejected the token it had.
    private var welcomesBack: Bool {
        if problem.isRejection { return true }
        if case .read(let entries) = model.sidebar { return !entries.repositories.isEmpty }
        return false
    }
}

extension SetupProblem {
    /// Whether signing in here can fix it: not while the token comes from
    /// the environment, which wins over the Keychain's.
    var signingInHelps: Bool {
        switch self {
        case .signedOut: true
        case .credentialsRejected(_, let source): source == .stored
        case .noUsableGh: false
        }
    }

    var isRejection: Bool {
        if case .credentialsRejected = self { return true }
        return false
    }
}

/// What went wrong with signing in, when something did: GitHub rejected the
/// token, or Verdandi's way to GitHub did not answer.
private struct ProblemCallout: View {
    var title: String
    var paragraphs: [String]
    var symbol: String

    init?(_ problem: SetupProblem) {
        switch problem {
        case .signedOut:
            return nil
        case .credentialsRejected(let login, .stored):
            let account = login.map { " for @\($0)" } ?? ""
            title = "GitHub rejected the token"
            paragraphs = [
                "GitHub does not accept the token\(account): it may be mistyped, or have expired or been revoked. Sign in with another."
            ]
            symbol = "key.slash"
        case .credentialsRejected(_, let source):
            let name = source.rawValue
            title = "GitHub rejected the token in \(name)"
            paragraphs = [
                "Verdandi was launched with \(name) set, so it reads GitHub with that token instead of one you sign in with here, and GitHub rejected it.",
                "Change or remove \(name) where Verdandi is launched, then launch it again.",
            ]
            symbol = "key.slash"
        case .noUsableGh(let notUsable):
            title = "Verdandi cannot reach GitHub"
            paragraphs =
                ["The part of Verdandi that talks to GitHub did not answer. Check again, or launch Verdandi again."]
                + notUsable.map(\.reason)
            symbol = "exclamationmark.triangle"
        }
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(.orange)
                .symbolRenderingMode(.hierarchical)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.headline)
                ForEach(paragraphs, id: \.self) { paragraph in
                    Text(paragraph)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(.orange.opacity(0.12), in: .rect(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// Check Again, for a problem signing in here cannot fix.
private struct CheckAgainButton: View {
    @Environment(AppModel.self) private var model
    @State private var checking = false

    var body: some View {
        Button {
            checking = true
            Task {
                if let core = model.core { await model.attempt { model.setup = try await core.checkSetupAgain() } }
                checking = false
            }
        } label: {
            HStack(spacing: 8) {
                if checking { ProgressView() }
                Text(checking ? "Checking…" : "Check Again")
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.glassProminent)
        .controlSize(.large)
        .disabled(checking)
    }
}

// MARK: - Ways in

/// Sign In with GitHub when this build can, then a personal access token,
/// which waits behind a button of its own while GitHub's way is offered.
private struct SignInOptions: View {
    @Environment(AppModel.self) private var model
    /// Whether GitHub rejected the token before, so that it is asked for
    /// again at once.
    var rejected: Bool
    @State private var showsToken = false

    var body: some View {
        VStack(spacing: 20) {
            if let flow = deviceFlow {
                DeviceFlowSection(flow: flow, autostarts: model.launch.deviceFlow != nil)
                if showsToken || rejected {
                    OrDivider()
                    TokenSection()
                        .transition(.opacity.combined(with: .move(edge: .top)))
                } else {
                    Button("Use a Personal Access Token") {
                        withAnimation(.smooth) { showsToken = true }
                    }
                    .buttonStyle(.glass)
                    .controlSize(.large)
                }
            } else {
                TokenSection()
            }
        }
    }

    /// GitHub's device flow, with this build's OAuth App, if it has one.
    private var deviceFlow: DeviceFlow? {
        if model.launch.deviceFlow == .demo { return .demo }
        let bundled = Bundle.main.object(forInfoDictionaryKey: "VerdandiGitHubClientID") as? String
        guard let clientID = model.launch.clientID ?? bundled, !clientID.isEmpty else { return nil }
        return DeviceFlow(clientID: clientID)
    }
}

/// A line with "or" in it, between two ways in.
private struct OrDivider: View {
    var body: some View {
        HStack(spacing: 12) {
            line
            Text("or").font(.subheadline).foregroundStyle(.secondary)
            line
        }
        .accessibilityHidden(true)
    }

    private var line: some View {
        Rectangle().fill(.separator).frame(height: 1)
    }
}

/// A field's solid ground over the backdrop.
private let fieldBackground = Color(uiColor: .secondarySystemGroupedBackground)

/// Signing in with GitHub's device flow: a code to enter on github.com,
/// while the app asks GitHub at its interval whether it was entered.
private struct DeviceFlowSection: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    let flow: DeviceFlow
    var autostarts: Bool

    @State private var step = Step.idle
    @State private var task: Task<Void, Never>?
    /// Which attempt is the latest, so that an older one says nothing.
    @State private var attempt = 0
    @State private var copied = false
    /// The code, large enough to read across a desk, and larger with the
    /// text size.
    @ScaledMetric(relativeTo: .largeTitle) private var codeSize: CGFloat = 44
    /// Whether a launch has started it already, so that it does not start
    /// again as the screen comes back.
    private static var autostarted = false

    enum Step: Equatable {
        case idle
        case requesting
        case waiting(DeviceCode)
        case signingIn
        case failed(String)
    }

    var body: some View {
        Group {
            switch step {
            case .idle, .requesting, .failed:
                start
            case .waiting(let code):
                codeCard(code)
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
            case .signingIn:
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Signing in…").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, minHeight: 50)
            }
        }
        .animation(.smooth(duration: 0.3), value: step)
        .onAppear {
            guard autostarts, !Self.autostarted else { return }
            Self.autostarted = true
            begin()
        }
        .onDisappear { task?.cancel() }
    }

    private var start: some View {
        VStack(spacing: 10) {
            Button(action: begin) {
                HStack(spacing: 8) {
                    if step == .requesting {
                        ProgressView()
                    } else {
                        Image(systemName: "person.badge.key.fill")
                    }
                    Text(step == .requesting ? "Asking GitHub for a Code…" : "Sign In with GitHub")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .disabled(step == .requesting)
            if case .failed(let message) = step {
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("You enter a code on github.com, in any browser, to let Verdandi read your issues.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
    }

    private func codeCard(_ code: DeviceCode) -> some View {
        VStack(spacing: 16) {
            Text("Enter this code on GitHub")
                .font(.headline)
            Text(code.userCode)
                .font(.system(size: codeSize, weight: .bold, design: .monospaced))
                .tracking(2)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .textSelection(.enabled)
                .accessibilityLabel(code.userCode.map(String.init).joined(separator: " "))
            // Side by side, or one above the other at a large text size.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { codeButtons(code, stacked: false) }
                    .fixedSize()
                VStack(spacing: 10) { codeButtons(code, stacked: true) }
            }
            .controlSize(.large)
            .sensoryFeedback(.success, trigger: copied) { _, now in now }
            VStack(spacing: 4) {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Waiting for you to authorize Verdandi…")
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text("The code works for \(remaining(until: code.expiresAt, now: context.date)) more.")
                        .monospacedDigit()
                }
                .font(.footnote)
                .foregroundStyle(.tertiary)
            }
            Button("Cancel", role: .cancel) {
                task?.cancel()
                step = .idle
            }
            .font(.subheadline)
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .background(fieldBackground, in: .rect(cornerRadius: 26, style: .continuous))
    }

    /// Copy, and Open GitHub, which copies the code too, to paste there;
    /// as wide as each other when stacked.
    @ViewBuilder private func codeButtons(_ code: DeviceCode, stacked: Bool) -> some View {
        Button {
            copy(code)
        } label: {
            Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                .frame(maxWidth: stacked ? .infinity : nil)
        }
        .buttonStyle(.glass)
        .contentTransition(.symbolEffect(.replace))
        Button {
            copy(code)
            openURL(code.verificationURI)
        } label: {
            Label("Open GitHub", systemImage: "arrow.up.forward")
                .frame(maxWidth: stacked ? .infinity : nil)
        }
        .buttonStyle(.glassProminent)
    }

    /// Asks GitHub for a code, then for the token until the user has
    /// entered it, then signs in with it.
    private func begin() {
        task?.cancel()
        attempt += 1
        let current = attempt
        step = .requesting
        copied = false
        task = Task {
            // A cancelled attempt, or one a newer replaced, says nothing:
            // its last request fails as it is cancelled, not as GitHub
            // failed it.
            @MainActor func show(_ next: Step) {
                guard !Task.isCancelled, current == attempt else { return }
                step = next
            }
            do {
                let code = try await flow.requestCode()
                show(.waiting(code))
                let token = try await flow.token(for: code)
                guard !Task.isCancelled, current == attempt else { return }
                show(.signingIn)
                try await model.signIn(token: token)
                if case .blocked = model.setup {
                    show(.failed("GitHub did not accept the token it handed out. Try again."))
                }
            } catch is CancellationError {
                // Cancelled, or the screen went: nothing to say.
            } catch {
                show(.failed(error.localizedDescription))
            }
        }
    }

    private func copy(_ code: DeviceCode) {
        UIPasteboard.general.string = code.userCode
        copied = true
        Task {
            try? await Task.sleep(for: .seconds(2))
            copied = false
        }
    }

    /// `14:32`, the minutes and seconds left.
    private func remaining(until end: Date, now: Date) -> String {
        let seconds = max(Int(end.timeIntervalSince(now)), 0)
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}

/// Signing in with a personal access token: a link to create one on
/// GitHub, what it needs, and a field to paste it into.
private struct TokenSection: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var token = ""
    @State private var signingIn = false
    @State private var error: String?
    @FocusState private var focused: Bool
    /// Whether a launch has signed in with its token already.
    private static var launchTokenUsed = false

    /// GitHub's page for a new classic token, with Verdandi's scopes ticked.
    static let newTokenPage = URL(
        string: "https://github.com/settings/tokens/new?scopes=repo,read:org&description=Verdandi%20for%20iOS")

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Sign in with a personal access token")
                .font(.headline)
            Text(
                "Create a classic token with the **repo** and **read:org** scopes, then paste it here. A fine-grained token works too, with read access to Issues and Metadata in the repositories you track."
            )
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            if let page = Self.newTokenPage {
                Button("Create a Token on GitHub", systemImage: "arrow.up.forward.square") { openURL(page) }
                    .buttonStyle(.glass)
            }
            field
            if let error {
                Text(error)
                    .font(.subheadline)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button(action: signIn) {
                HStack(spacing: 8) {
                    if busy { ProgressView() }
                    Text(busy ? "Checking with GitHub…" : "Sign In")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .disabled(trimmed.isEmpty || busy)
        }
        .onAppear(perform: useLaunchToken)
    }

    private var field: some View {
        HStack(spacing: 6) {
            Image(systemName: "key.horizontal")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            SecureField("Personal access token", text: $token, prompt: Text("ghp_… or github_pat_…"))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .focused($focused)
                .onSubmit(signIn)
                .privacySensitive()
                .disabled(busy)
            PasteButton(payloadType: String.self) { strings in
                let pasted = strings.first?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                Task { @MainActor in
                    token = pasted
                    error = nil
                }
            }
            .labelStyle(.iconOnly)
            .buttonBorderShape(.capsule)
            .disabled(busy)
        }
        .padding(.leading, 14)
        .padding(.trailing, 6)
        .frame(minHeight: 52)
        .background(fieldBackground, in: .rect(cornerRadius: 16, style: .continuous))
    }

    private var trimmed: String { token.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var busy: Bool { signingIn || model.setup == .checking }

    private func signIn() {
        let value = trimmed
        guard !value.isEmpty, !busy else { return }
        signingIn = true
        error = nil
        focused = false
        Task {
            do {
                try await model.signIn(token: value)
            } catch {
                self.error = error.localizedDescription
            }
            signingIn = false
            // GitHub rejected it: the field is ready for another.
            if case .blocked = model.setup {
                token = ""
                focused = true
            }
        }
    }

    /// `VERDANDI_SIGN_IN`: the launch's token, typed in and signed in with
    /// once.
    private func useLaunchToken() {
        guard let launchToken = model.launch.signInToken, !Self.launchTokenUsed else { return }
        Self.launchTokenUsed = true
        token = launchToken
        signIn()
    }
}

/// An icon above its title, both centred, for a line under the ways in.
private struct CenteredLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        VStack(spacing: 6) {
            configuration.icon
            configuration.title
        }
    }
}

extension DeviceFlow {
    /// A made-up GitHub for `VERDANDI_DEVICE_FLOW=demo`: it hands out a code
    /// and never sees it entered.
    static let demo = DeviceFlow(
        clientID: "demo",
        post: { url, _ in
            if url.path().hasSuffix("/device/code") {
                let code = #"{"device_code":"demo","user_code":"WDJB-MJHT","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}"#
                return (200, Data(code.utf8))
            }
            return (200, Data(#"{"error":"authorization_pending"}"#.utf8))
        })
}
