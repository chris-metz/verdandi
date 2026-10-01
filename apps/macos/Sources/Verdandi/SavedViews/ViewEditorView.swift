import SwiftUI
import VerdandiCore

/// The sheet that creates a view, edits one, or creates a copy of one: its
/// name and GitHub search, what the search covers, snippets to build it
/// from, and a live preview of what it finds. GitHub checks the search as
/// it is typed; one it rejects cannot be saved.
struct ViewEditorView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let view: SavedView?
  let duplicate: Bool
  @State private var name: String
  @State private var query: String
  @State private var preview = ViewSearchPreview()
  /// The ID a new view gets, the same however often Save is pressed.
  @State private var newID = SavedView.newId()
  @State private var isSaved = false
  @FocusState private var focus: Field?

  private enum Field { case name, query }

  init(view: SavedView?, duplicate: Bool) {
    self.view = view
    self.duplicate = duplicate
    let copy = duplicate ? view?.duplicate : nil
    _name = State(initialValue: copy?.name ?? view?.name ?? SidebarLaunchOptions.viewName)
    _query = State(initialValue: view?.query ?? SidebarLaunchOptions.viewQuery)
  }

  var body: some View {
    VStack(spacing: 0) {
      header
        .padding(.horizontal, 24)
        .padding(.top, 20)
      Form {
        fields
        Section {
          SnippetChips(query: $query, snippets: QuerySnippet.all(tracked: model.settings.repositories.map(\.address)))
        } header: {
          Text("Add to the Search")
        }
        PreviewSection(preview: preview, query: trimmedQuery)
      }
      .formStyle(.grouped)
      .scrollContentBackground(.hidden)
      Divider()
      footer
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }
    .frame(width: 600, height: 700)
    .task(id: trimmedQuery) { await runPreview() }
    .onAppear { focus = isEditing ? .query : .name }
  }

  // MARK: Parts

  private var header: some View {
    HStack(alignment: .top, spacing: 14) {
      Image(systemName: "line.3.horizontal.decrease")
        .font(.title2.weight(.semibold))
        .foregroundStyle(.tint)
        .frame(width: 44, height: 44)
        .background(.tint.opacity(0.14), in: .rect(cornerRadius: 11, style: .continuous))
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 3) {
        Text(title)
          .font(.title2.weight(.semibold))
        Text("A view is a saved GitHub issue search. Its search alone decides what it shows.")
          .font(.callout)
          .foregroundStyle(.secondary)
      }
      Spacer(minLength: 0)
    }
  }

  private var fields: some View {
    Section {
      FieldRow("Name") {
        TextField("Name", text: $name, prompt: Text("e.g. Assigned to me"))
          .focused($focus, equals: .name)
          .onSubmit { focus = .query }
      }
      FieldRow("Search") {
        TextField("Search", text: $query, prompt: Text("is:open assignee:@me"), axis: .vertical)
          .font(.body.monospaced())
          .lineLimit(2...6)
          .focused($focus, equals: .query)
          .onSubmit(save)
      }
    } footer: {
      ScopeLine(query: query)
    }
  }

  private var footer: some View {
    HStack(spacing: 10) {
      if !model.sidebar.canChange {
        Label("settings.json can’t be read", systemImage: "exclamationmark.triangle.fill")
          .font(.callout)
          .foregroundStyle(.secondary)
          .symbolRenderingMode(.multicolor)
      }
      Spacer(minLength: 12)
      Button("Cancel", role: .cancel) { dismiss() }
        .buttonStyle(.glass)
        .keyboardShortcut(.cancelAction)
      Button(isEditing ? "Save" : "Create View", action: save)
        .buttonStyle(.glassProminent)
        .keyboardShortcut(.defaultAction)
        .disabled(!canSave)
    }
    .controlSize(.large)
  }

  // MARK: State

  private var isEditing: Bool { view != nil && !duplicate }

  private var title: String {
    if duplicate { return "Duplicate View" }
    return view == nil ? "New View" : "Edit View"
  }

  private var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
  private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

  /// Whether the view can be saved: named, with a search GitHub has not
  /// rejected. One GitHub could not check, e.g. offline, can be saved.
  private var canSave: Bool {
    guard !trimmedName.isEmpty, !trimmedQuery.isEmpty, model.sidebar.canChange else { return false }
    if case .rejected = preview.result, preview.query == trimmedQuery { return false }
    return true
  }

  /// Runs the search once typing pauses, for its count and first matches.
  private func runPreview() async {
    let query = trimmedQuery
    guard !query.isEmpty else {
      preview = ViewSearchPreview()
      return
    }
    // The search as saved need not run again to show it.
    if preview.query == query, preview.result != nil { return }
    preview.isRunning = true
    do {
      try await Task.sleep(for: .milliseconds(600))
    } catch {
      return
    }
    guard let client = model.client else { return }
    let result: ViewSearchPreview.Result
    do {
      let page = try await client.searchPreview(query, count: 5)
      result = .matches(total: page.total, incomplete: page.incomplete, issues: page.issues)
    } catch {
      if case .invalidSearch(let message) = error {
        result = .rejected(message)
      } else {
        result = .failed(error)
      }
    }
    guard !Task.isCancelled else { return }
    withAnimation(.smooth) {
      preview = ViewSearchPreview(query: query, result: result)
    }
  }

  private func save() {
    guard canSave, !isSaved else { return }
    isSaved = true
    // Editing keeps the view's ID; a new view or a copy gets one of its own.
    var saved = (isEditing ? view : nil) ?? SavedView(id: newID, name: "", query: "")
    saved.name = trimmedName
    saved.query = trimmedQuery
    if preview.query == saved.query, case .matches(let total, let incomplete, _) = preview.result {
      model.sidebar.takeMatchCount(.known(total, incomplete: incomplete), for: saved.query)
    }
    model.sidebar.saveView(saved, after: duplicate ? view?.id : nil)
    dismiss()
  }
}

/// A field with its label in a column of its own, so that the field starts
/// at the same place in every row and fills the rest.
private struct FieldRow<Field: View>: View {
  var label: String
  @ViewBuilder var field: Field

  init(_ label: String, @ViewBuilder field: () -> Field) {
    self.label = label
    self.field = field()
  }

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 12) {
      Text(label)
        .frame(width: 52, alignment: .leading)
      field
        .labelsHidden()
        .textFieldStyle(.plain)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

/// What the editor last learned of a search.
struct ViewSearchPreview: Equatable {
  enum Result: Equatable {
    case matches(total: Int, incomplete: Bool, issues: [Issue])
    case rejected(String)
    case failed(GitHubError)
  }

  /// The search the result is of.
  var query: String = ""
  var result: Result?
  /// Whether a newer search is running, while the last result shows.
  var isRunning = false
}

/// Says what a search covers, from its `repo:`, `org:` and `user:`
/// qualifiers alone, and warns when it combines repositories so that it
/// matches nothing.
private struct ScopeLine: View {
  var query: String

  var body: some View {
    let scope = ViewScope(query: query)
    VStack(alignment: .leading, spacing: 4) {
      if let combined = scope.combinedRepositories {
        Label {
          let joined = combined.map { "repo:\($0)" }.joined(separator: " OR ")
          Text("Several repo: qualifiers without OR must all hold at once, so this matches nothing. Join them with OR: (\(joined)).")
        } icon: {
          Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
        }
      }
      Label {
        Text(description(scope))
      } icon: {
        Image(systemName: scope.targets == nil ? "globe" : "scope")
      }
      .foregroundStyle(.secondary)
    }
    .font(.caption)
    .fixedSize(horizontal: false, vertical: true)
    .animation(.smooth, value: scope)
  }

  private func description(_ scope: ViewScope) -> String {
    guard let targets = scope.targets else {
      return "Searches every repository you can read on GitHub, tracked or not."
    }
    let names = targets.map { target in
      switch target {
      case .repository(let name): name
      case .owner(let login): "\(login)’s repositories"
      }
    }
    return "Searches only \(names.formatted(.list(type: .or))). Tracked repositories never change that."
  }
}

/// The search's count and first matches, or why GitHub would not run it.
private struct PreviewSection: View {
  var preview: ViewSearchPreview
  var query: String

  var body: some View {
    Section {
      content
        .opacity(preview.isRunning ? 0.55 : 1)
    } header: {
      HStack {
        Text("Preview")
        Spacer()
        if preview.isRunning {
          ProgressView().controlSize(.mini)
        } else if case .matches(let total, _, _) = preview.result {
          Text("^[\(total) match](inflect: true)")
            .monospacedDigit()
            .contentTransition(.numericText(value: Double(total)))
        }
      }
    }
  }

  @ViewBuilder
  private var content: some View {
    if query.isEmpty {
      Text("Type a search to see what it finds.")
        .foregroundStyle(.secondary)
    } else {
      switch preview.result {
      case nil:
        Text("Searching GitHub…")
          .foregroundStyle(.secondary)
      case .rejected(let message):
        Label {
          VStack(alignment: .leading, spacing: 2) {
            Text("GitHub rejects this search").fontWeight(.medium)
            Text(message).font(.callout).textSelection(.enabled)
          }
        } icon: {
          Image(systemName: "xmark.octagon.fill")
        }
        .foregroundStyle(.red)
      case .failed(let error):
        Label(error.message, systemImage: "wifi.exclamationmark")
          .foregroundStyle(.secondary)
      case .matches(_, let incomplete, let issues):
        if issues.isEmpty {
          Text("No issues match.")
            .foregroundStyle(.secondary)
        }
        ForEach(issues) { issue in
          HStack(spacing: 8) {
            IssueStateIcon(state: issue.state)
            Text(issue.title)
              .lineLimit(1)
            Spacer(minLength: 8)
            Text(issue.qualifiedReference)
              .font(.caption)
              .monospacedDigit()
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }
        }
        if incomplete {
          Text("GitHub did not search everything in time; there may be more.")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }
    }
  }
}
