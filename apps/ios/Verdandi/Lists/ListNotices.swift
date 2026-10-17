import SwiftUI
import VerdandiKit

/// A line above a list's issues that says what it leaves out or could not
/// read, with what to do about it. It scrolls with the issues, as part of
/// the list, and is no issue: the selection passes it by.
struct ListNotice<Actions: View>: View {
    enum Tone { case info, warning }

    @Environment(\.palette) private var palette
    var tone: Tone = .warning
    var systemImage: String
    var text: String
    var detail: String?
    @ViewBuilder var actions: () -> Actions

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: systemImage)
                .foregroundStyle(tone == .warning ? palette.warning : palette.muted)
            VStack(alignment: .leading, spacing: 2) {
                Text(text)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(palette.foreground)
                if let detail, !detail.isEmpty {
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(palette.muted)
                }
                HStack(spacing: 14) { actions() }
                    .font(.subheadline.weight(.semibold))
                    .buttonStyle(.borderless)
                    .padding(.top, 2)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(
            (tone == .warning ? palette.warning.opacity(0.12) : palette.muted.opacity(0.1)),
            in: .rect(cornerRadius: 14, style: .continuous)
        )
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
        .listRowBackground(Color.clear)
        .selectionDisabled()
    }
}

extension ListNotice where Actions == EmptyView {
    init(tone: Tone = .warning, systemImage: String, text: String, detail: String? = nil) {
        self.init(tone: tone, systemImage: systemImage, text: text, detail: detail) { EmptyView() }
    }
}

/// Why a list could not be read, in place of its issues: what the app
/// says of the problem, GitHub's own words, and what to do: Retry, Open on
/// GitHub where its page is known, and GitHub's own link, if it gave one.
struct ListProblem<Actions: View>: View {
    @Environment(\.openURL) private var openURL
    var title: String
    var problem: Problem
    var login: String?
    var repository: RepositoryAddress?
    /// Its page on GitHub, if known.
    var url: URL?
    var retry: () -> Void
    @ViewBuilder var actions: () -> Actions

    var body: some View {
        let text = ProblemText(problem, login: login, repository: repository)
        ContentUnavailableView {
            Label(title, systemImage: symbol)
        } description: {
            VStack(spacing: 6) {
                Text(text.text)
                if let detail = text.detail { Text(detail).font(.footnote) }
            }
        } actions: {
            Button("Retry", action: retry)
                .buttonStyle(.glassProminent)
            if let url {
                Button("Open on GitHub") { openURL(url) }
                    .buttonStyle(.glass)
            }
            if let link = text.link {
                Button(link.label) { openURL(link.url) }
                    .buttonStyle(.glass)
            }
            actions()
        }
    }

    private var symbol: String {
        switch problem {
        case .unreachable: "wifi.exclamationmark"
        case .unavailable: "eye.slash"
        default: "exclamationmark.triangle"
        }
    }
}

extension ListProblem where Actions == EmptyView {
    init(
        title: String, problem: Problem, login: String?, repository: RepositoryAddress? = nil, url: URL?,
        retry: @escaping () -> Void
    ) {
        self.init(
            title: title, problem: problem, login: login, repository: repository, url: url, retry: retry
        ) { EmptyView() }
    }
}

/// What a list shows while nothing of it has loaded: a closed list counts
/// the issues it has read, out of how many there are.
struct ListLoadingView: View {
    var title: String
    var progress: ListLoading.ListProgress?

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(title)
            } icon: {
                ProgressView().controlSize(.large)
            }
        } description: {
            if let progress, let total = progress.total, total > 0 {
                VStack(spacing: 8) {
                    ProgressView(value: Double(min(progress.read, total)), total: Double(total))
                        .frame(maxWidth: 220)
                    Text("\(progress.read.formatted()) of \(total.formatted())")
                        .monospacedDigit()
                }
            }
        }
    }
}

/// The line under a list's issues: what it counts, in full.
struct ListFooter: View {
    @Environment(\.palette) private var palette
    var text: String

    var body: some View {
        if !text.isEmpty {
            Text(text)
                .font(.footnote)
                .foregroundStyle(palette.muted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
                .selectionDisabled()
        }
    }
}

/// The line under a list's title: what it counts and how current it is,
/// pinned above the issues.
struct ListStatus: View {
    @Environment(\.palette) private var palette
    var text: String

    var body: some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(palette.muted)
            .lineLimit(1)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 20)
    }
}
