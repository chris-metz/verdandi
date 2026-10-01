import SwiftUI
import VerdandiCore

/// Go to Issue (⌘K) over the window: the palette near the top, above a
/// faint dimming that closes it when clicked.
struct GoToIssueOverlay: View {
  @Environment(AppModel.self) private var model
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    ZStack(alignment: .top) {
      if model.sheet == .goToIssue {
        Color.black.opacity(colorScheme == .dark ? 0.32 : 0.14)
          .ignoresSafeArea()
          .contentShape(.rect)
          .onTapGesture { model.sheet = nil }
          .accessibilityHidden(true)
          .transition(.opacity)
        GoToIssueView()
          .padding(.top, 64)
          .padding(.horizontal, 24)
          .transition(.scale(scale: 0.94, anchor: .top).combined(with: .opacity))
      }
    }
    .animation(.spring(duration: 0.32, bounce: 0.18), value: model.sheet == .goToIssue)
  }
}

/// The Go to Issue palette: a field that takes `owner/name#12`,
/// `owner/name 12`, a link to an issue on GitHub, or `#12` for the selected
/// repository, and the issues gone to before. Return goes to the
/// highlighted one, the arrow keys move the highlight, Escape closes it. A
/// pull request opens on GitHub instead, as Verdandi shows only issues.
struct GoToIssueView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.openURL) private var openURL
  @State private var text = LaunchOptions.goToText ?? ""
  @State private var recents = RecentIssues.load()
  @State private var highlighted = 0
  @State private var status = LookupStatus.idle
  @State private var lookup: Task<Void, Never>?
  @FocusState private var fieldFocused: Bool

  /// What the palette says of the issue being looked up.
  enum LookupStatus: Equatable {
    case idle
    case lookingUp(String)
    /// Why it cannot go there, and GitHub's own words, if more.
    case failed(String, detail: String? = nil)
  }

  /// Somewhere Return goes.
  enum Destination: Hashable {
    /// An issue to ask GitHub about first.
    case lookUp(RepositoryAddress, number: Int)
    /// An issue gone to before, whose node ID is known.
    case recent(RecentIssue)
  }

  var body: some View {
    let destinations = destinations
    VStack(alignment: .leading, spacing: 0) {
      field
      if !destinations.isEmpty || message != nil {
        Divider().padding(.horizontal, 16)
        VStack(alignment: .leading, spacing: 2) {
          if let message { messageRow(message) }
          rows(destinations)
        }
        .padding(8)
      }
      Divider().padding(.horizontal, 16)
      keyHints
    }
    .frame(maxWidth: 620)
    // A touch of the window's colour keeps busy lists behind it legible.
    .glassEffect(.regular.tint(Color(nsColor: .windowBackgroundColor).opacity(0.45)), in: .rect(cornerRadius: 26))
    .shadow(color: .black.opacity(0.12), radius: 30, y: 12)
    .onExitCommand(perform: close)
    .onChange(of: text) {
      highlighted = 0
      lookup?.cancel()
      status = .idle
    }
    .onDisappear { lookup?.cancel() }
    .task {
      fieldFocused = true
      if LaunchOptions.submitsGoTo { go() }
    }
    .animation(.snappy(duration: 0.2), value: destinations)
    .animation(.snappy(duration: 0.2), value: status)
  }

  // MARK: Parts

  private var field: some View {
    HStack(spacing: 14) {
      Image(systemName: "number")
        .font(.title2.weight(.medium))
        .foregroundStyle(.secondary)
        .frame(width: 26)
        .accessibilityHidden(true)
      TextField("Go to Issue", text: $text, prompt: Text(prompt))
        .textFieldStyle(.plain)
        .font(.title2)
        .focused($fieldFocused)
        .onSubmit(go)
        .onKeyPress(.downArrow) {
          move(by: 1)
          return .handled
        }
        .onKeyPress(.upArrow) {
          move(by: -1)
          return .handled
        }
        .onKeyPress(.escape) {
          close()
          return .handled
        }
      if case .lookingUp = status {
        ProgressView().controlSize(.small)
      }
    }
    .padding(.horizontal, 20)
    .frame(height: 64)
  }

  private func rows(_ destinations: [Destination]) -> some View {
    ForEach(Array(destinations.enumerated()), id: \.element) { index, destination in
      if index == firstRecentIndex(in: destinations) {
        Text("Recent")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.secondary)
          .padding(.horizontal, 12)
          .padding(.top, index == 0 ? 4 : 10)
          .padding(.bottom, 4)
      }
      DestinationRow(destination: destination, isHighlighted: index == highlightedIndex(in: destinations))
        .contentShape(.rect)
        .onTapGesture { go(to: destination) }
        .onContinuousHover { phase in
          if case .active = phase { highlighted = index }
        }
    }
  }

  private func messageRow(_ message: Message) -> some View {
    Label {
      VStack(alignment: .leading, spacing: 2) {
        Text(message.text)
        if let detail = message.detail {
          Text(detail).font(.caption).foregroundStyle(.secondary)
        }
      }
      .fixedSize(horizontal: false, vertical: true)
      .textSelection(.enabled)
    } icon: {
      Image(systemName: message.symbol)
        .foregroundStyle(message.isProblem ? AnyShapeStyle(.red) : AnyShapeStyle(.secondary))
    }
    .font(.callout)
    .foregroundStyle(message.isProblem ? .primary : .secondary)
    .padding(.horizontal, 12)
    .padding(.vertical, 8)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var keyHints: some View {
    HStack(spacing: 16) {
      KeyHint(keys: "↑↓", action: "Choose")
      KeyHint(keys: "↩", action: "Go")
      KeyHint(keys: "esc", action: "Close")
      Spacer()
      if let repository = selectedRepository {
        Text("#12 goes to \(repository.description)")
          .lineLimit(1)
          .truncationMode(.middle)
      }
    }
    .font(.caption)
    .foregroundStyle(.secondary)
    .padding(.horizontal, 20)
    .padding(.vertical, 10)
  }

  // MARK: What it offers

  private var prompt: String {
    selectedRepository == nil ? "owner/name#12 or a link to an issue" : "owner/name#12, a link, or #12"
  }

  /// The repository a bare `#12` names: the selected one.
  private var selectedRepository: RepositoryAddress? {
    if case .repository(let address) = model.selection { return address }
    return nil
  }

  private var trimmedText: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

  /// The issue typed, if what is typed names one.
  private var typed: Destination? {
    guard let locator = IssueLocator(parsing: trimmedText),
      let repository = locator.repository ?? selectedRepository
    else { return nil }
    if let recent = recents.first(where: { $0.repository == repository && $0.number == locator.number }) {
      return .recent(recent)
    }
    return .lookUp(repository, number: locator.number)
  }

  /// What Return can go to: the issue typed first, if any, then the recent
  /// issues that match what is typed.
  private var destinations: [Destination] {
    let typed = typed
    let query = trimmedText
    let matching = recents.filter { recent in
      query.isEmpty || recent.qualifiedReference.localizedCaseInsensitiveContains(query)
        || recent.title.localizedCaseInsensitiveContains(query)
    }
    return (typed.map { [$0] } ?? []) + matching.map(Destination.recent).filter { $0 != typed }
  }

  /// Where the recent issues start, below the issue typed.
  private func firstRecentIndex(in destinations: [Destination]) -> Int? {
    let start = typed == nil ? 0 : 1
    return destinations.count > start ? start : nil
  }

  private func highlightedIndex(in destinations: [Destination]) -> Int {
    min(max(highlighted, 0), max(destinations.count - 1, 0))
  }

  /// A line above the rows: the lookup under way, why it failed, or how to
  /// type an issue.
  private struct Message {
    var text: String
    var detail: String?
    var symbol: String
    var isProblem = false
  }

  private var message: Message? {
    switch status {
    case .lookingUp(let reference):
      return Message(text: "Looking up \(reference)…", symbol: "magnifyingglass")
    case .failed(let reason, let detail):
      return Message(text: reason, detail: detail, symbol: "exclamationmark.circle.fill", isProblem: true)
    case .idle:
      break
    }
    guard !trimmedText.isEmpty, destinations.isEmpty else { return nil }
    if let locator = IssueLocator(parsing: trimmedText), locator.repository == nil {
      return Message(
        text: "Select a repository in the sidebar to go to #\(locator.number) in it, or type owner/name#\(locator.number).",
        symbol: "info.circle")
    }
    return Message(text: "Type owner/name#12, a link to an issue on GitHub, or #12 in the selected repository.", symbol: "info.circle")
  }

  // MARK: Going

  private func move(by step: Int) {
    let count = destinations.count
    guard count > 0 else { return }
    highlighted = (highlightedIndex(in: destinations) + step + count) % count
  }

  private func go() {
    let destinations = destinations
    guard !destinations.isEmpty else {
      if let message, !trimmedText.isEmpty { status = .failed(message.text) }
      return
    }
    go(to: destinations[highlightedIndex(in: destinations)])
  }

  private func go(to destination: Destination) {
    switch destination {
    case .recent(let recent):
      open(model.issues[recent.id]?.reference ?? recent.reference)
    case .lookUp(let repository, let number):
      // An issue read before needs no lookup.
      if let known = model.issues.issues.values.first(where: { $0.repository == repository && $0.number == number }) {
        open(known.reference)
        return
      }
      guard let client = model.client else { return }
      let reference = repository.reference(number)
      status = .lookingUp(reference)
      lookup?.cancel()
      lookup = Task {
        let item: NumberedItem
        do throws(GitHubError) {
          item = try await client.item(numbered: number, in: repository)
        } catch {
          if !Task.isCancelled { status = failure(error) }
          return
        }
        guard !Task.isCancelled else { return }
        switch item {
        case .issue(let issue, _):
          open(issue)
        case .pullRequest(let url):
          openURL(url)
          model.report(
            "Opened a Pull Request on GitHub", "\(reference) is a pull request, and Verdandi shows only issues.",
            kind: .info)
          close()
        }
      }
    }
  }

  /// What the palette says of a failed lookup: what GitHub will not show is
  /// unavailable or not accessible, in GitHub's words below.
  private func failure(_ error: GitHubError) -> LookupStatus {
    guard case .unavailable(let message) = error else { return .failed(error.message) }
    let account = model.login.map { " (@\($0))" } ?? ""
    return .failed("Unavailable or not accessible with this account\(account)", detail: message)
  }

  /// Shows an issue, in its repository's list when it is tracked.
  private func open(_ issue: IssueReference) {
    RecentIssues.record(issue)
    if model.settings.repositories.contains(where: { $0.address == issue.repository }) {
      model.selection = .repository(issue.repository)
    }
    model.openIssue(issue.id)
    close()
  }

  private func close() {
    lookup?.cancel()
    model.sheet = nil
  }
}

/// One row of the palette: the issue typed, or one gone to before.
private struct DestinationRow: View {
  @Environment(AppModel.self) private var model
  var destination: GoToIssueView.Destination
  var isHighlighted: Bool

  var body: some View {
    HStack(spacing: 10) {
      switch destination {
      case .lookUp(let repository, let number):
        Image(systemName: "arrow.right.circle.fill")
          .foregroundStyle(.tint)
          .frame(width: 20)
        Text("Go to \(Text(repository.reference(number)).fontWeight(.semibold))")
        Spacer(minLength: 8)
      case .recent(let recent):
        let issue = model.issues[recent.id]
        IssueStateIcon(state: issue?.state ?? recent.state)
          .frame(width: 20)
        Text(verbatim: "#\(recent.number)")
          .monospacedDigit()
          .foregroundStyle(.secondary)
          .frame(minWidth: 54, alignment: .leading)
        Text(issue?.title ?? recent.title)
          .lineLimit(1)
        Spacer(minLength: 8)
        Text(recent.repository.description)
          .font(.callout)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
      Image(systemName: "return")
        .font(.callout)
        .foregroundStyle(.secondary)
        .opacity(isHighlighted ? 1 : 0)
        .accessibilityHidden(true)
    }
    .padding(.horizontal, 12)
    .frame(height: 36)
    .background {
      if isHighlighted {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .fill(Color.accentColor.opacity(0.18))
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(isHighlighted ? [.isButton, .isSelected] : .isButton)
  }
}

/// A key and what it does, as the palette's footer names them.
private struct KeyHint: View {
  var keys: String
  var action: String

  var body: some View {
    HStack(spacing: 5) {
      Text(keys)
        .font(.caption.weight(.medium).monospaced())
        .padding(.horizontal, 5)
        .padding(.vertical, 1)
        .background(.quaternary, in: .rect(cornerRadius: 4))
      Text(action)
    }
  }
}
