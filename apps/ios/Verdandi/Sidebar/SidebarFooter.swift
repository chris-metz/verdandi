import SwiftUI
import VerdandiKit

/// The foot of the sidebar, floating over its end: the account GitHub is
/// read as, GitHub's rate limits beside it, and the settings.
struct SidebarFooter: View {
    @Environment(AppModel.self) private var model
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 10) {
            AccountLabel(account: account)
            Spacer(minLength: 8)
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 8) {
                    if model.setup.account != nil {
                        RateLimitsButton()
                    }
                    Button("Settings", systemImage: "gearshape") { model.sheet = .settings }
                        .labelStyle(.iconOnly)
                        .foregroundStyle(palette.muted)
                        .buttonStyle(.glass)
                        .buttonBorderShape(.circle)
                        .help("Settings")
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private var account: AccountStatus? {
        if case .ready(let account) = model.setup { return account }
        return nil
    }
}

/// The account GitHub is read as: its picture, `@login` and its host, and
/// where the token comes from when the environment gives it rather than
/// the Keychain. The token itself is never shown.
private struct AccountLabel: View {
    @Environment(\.palette) private var palette
    var account: AccountStatus?

    var body: some View {
        HStack(spacing: 10) {
            switch account {
            case .known(let account, let source):
                SidebarAvatar(login: account.login, size: 30)
                VStack(alignment: .leading, spacing: 0) {
                    Text("@\(account.login)")
                        .font(.subheadline.weight(.medium))
                        .lineLimit(1)
                    Text(source == .stored ? account.host : "\(account.host) · \(source.rawValue)")
                        .font(.caption)
                        .foregroundStyle(palette.muted)
                        .lineLimit(1)
                }
                .help(detail(source) ?? "GitHub is read as @\(account.login)")
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Signed in to \(account.host) as \(account.login)")
                .accessibilityHint(detail(source) ?? "")
            case .unconfirmed(let message):
                Image(systemName: "person.crop.circle.badge.questionmark")
                    .font(.title2)
                    .foregroundStyle(palette.muted)
                VStack(alignment: .leading, spacing: 0) {
                    Text("github.com")
                        .font(.subheadline.weight(.medium))
                    Text("Account not confirmed")
                        .font(.caption)
                        .foregroundStyle(palette.muted)
                }
                .help(message)
                .accessibilityElement(children: .combine)
                .accessibilityHint(message)
            case nil:
                ProgressView()
                    .controlSize(.small)
                Text("Checking GitHub access…")
                    .font(.caption)
                    .foregroundStyle(palette.muted)
            }
        }
    }

    /// Where the token comes from, when it is not the one kept in the
    /// Keychain: an environment variable, as a development launch sets it.
    private func detail(_ source: TokenSource) -> String? {
        source == .stored
            ? nil
            : "Verdandi reads GitHub with the token in \(source.rawValue), which overrides the one kept in the Keychain."
    }
}

/// An account's or organization's picture from GitHub, round.
struct SidebarAvatar: View {
    var login: String
    var size: CGFloat

    var body: some View {
        AsyncImage(url: SidebarLinks.avatar(login, points: size)) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            Image(systemName: "person.crop.circle.fill")
                .resizable()
                .foregroundStyle(.tertiary)
        }
        .frame(width: size, height: size)
        .clipShape(.circle)
        .accessibilityHidden(true)
    }
}
