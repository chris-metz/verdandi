import SwiftUI
import VerdandiKit

/// The sheet that creates a view, edits one, or duplicates one: its name
/// and GitHub search, a line saying what the search covers, snippets to
/// build it from and examples. Save runs the search once and saves only
/// what GitHub accepts; when it cannot be run, the view can be saved
/// anyway. A saved view is chosen in the sidebar. Editing keeps the view's
/// ID; a duplicate is a new view that goes right after its view.
struct ViewEditorView: View {
    let editing: SavedView?
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette
    @State private var purpose: Purpose?
    @State private var name = ""
    @State private var query = ""
    @State private var nameSelection: TextSelection?
    @State private var querySelection: TextSelection?
    @State private var busy = false
    @State private var outcome: Outcome?
    @State private var removalAsked = false
    @State private var saved = 0
    @FocusState private var focus: Field?

    init(editing: SavedView?) {
        self.editing = editing
    }

    /// What the editor is open for.
    enum Purpose: Equatable {
        case new
        case edit(SavedView)
        case duplicate(SavedView)
    }

    /// Why Save did not save, as it last found.
    enum Outcome: Equatable {
        case rejected(String)
        case unchecked(Problem)
        case failed(String)
    }

    private enum Field { case name, search }

    var body: some View {
        NavigationStack {
            Form {
                if !canChange {
                    Section {
                        Label(
                            "Views can’t be saved while settings.json can’t be written.",
                            systemImage: "exclamationmark.triangle.fill"
                        )
                        .font(.footnote)
                        .foregroundStyle(palette.warning)
                    }
                }
                Section("Name") {
                    TextField("Name", text: $name, selection: $nameSelection, prompt: Text("Open bugs"))
                        .focused($focus, equals: .name)
                        .submitLabel(.next)
                        .onSubmit { focus = .search }
                }
                Section {
                    TextField(
                        "GitHub search", text: $query, selection: $querySelection,
                        prompt: Text("is:open label:bug"), axis: .vertical
                    )
                    .font(.body.monospaced())
                    .lineLimit(3...8)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focus, equals: .search)
                    .onChange(of: query) { previous, current in typed(current, after: previous) }
                } header: {
                    Text("GitHub Search")
                } footer: {
                    ScopeLine(query: query, busy: busy)
                }
                if let outcome {
                    Section {
                        SaveProblem(outcome: outcome, busy: busy) {
                            save(force: true)
                        } tryAgain: {
                            save()
                        }
                    }
                    .transition(.blurReplace)
                }
                Section {
                    SnippetChips(query: query, snippets: QuerySnippet.offered(tracked: tracked)) { snippet in
                        choose(snippet)
                    }
                    .listRowInsets(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12))
                } header: {
                    Text("Add to the Search")
                }
                Section {
                    ForEach(examples) { example in
                        Button {
                            use(example)
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(example.query)
                                    .font(.footnote.monospaced())
                                    .foregroundStyle(palette.foreground)
                                Text(example.description)
                                    .font(.caption)
                                    .foregroundStyle(palette.muted)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Uses this search")
                    }
                } header: {
                    Text("Examples")
                }
                if case .edit = purpose {
                    Section {
                        Button("Remove View…", systemImage: "trash", role: .destructive) { removalAsked = true }
                            .disabled(busy || !canChange)
                    }
                }
            }
            .formStyle(.grouped)
            .animation(.smooth, value: outcome)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", systemImage: "xmark", role: .cancel) { dismiss() }
                        .disabled(busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if busy {
                        ProgressView()
                    } else {
                        Button("Save", systemImage: "checkmark", role: .confirm) { save() }
                            .disabled(!canSave)
                            .keyboardShortcut(.return, modifiers: .command)
                    }
                }
            }
            .confirmationDialog(removalTitle, isPresented: $removalAsked, titleVisibility: .visible) {
                Button("Remove", role: .destructive) { remove() }
            } message: {
                Text(ManagedEntry.viewRemovalMessage)
            }
        }
        .interactiveDismissDisabled(busy || changed)
        .sensoryFeedback(.success, trigger: saved)
        .onAppear(perform: start)
        .task {
            // The keyboard comes once the sheet is up.
            try? await Task.sleep(for: .milliseconds(450))
            guard !busy, outcome == nil else { return }
            switch purpose {
            case .edit:
                focus = .search
                // An edit goes on where the search ends.
                try? await Task.sleep(for: .milliseconds(100))
                querySelection = TextSelection(insertionPoint: query.endIndex)
            case .duplicate:
                focus = .name
                // The copy's name is there to be typed over.
                try? await Task.sleep(for: .milliseconds(100))
                nameSelection = TextSelection(range: name.startIndex..<name.endIndex)
            case .new, nil:
                focus = .name
            }
        }
        .onDisappear {
            model.editedView = nil
            model.duplicatedView = nil
        }
    }

    // MARK: State

    private var title: String {
        switch purpose {
        case .edit: "Edit View"
        case .duplicate: "Duplicate View"
        case .new, nil: "New View"
        }
    }

    private var tracked: [RepositoryAddress] {
        SidebarActions(model: model).entries?.repositories.map(\.repository.address) ?? []
    }

    private var examples: [ViewExample] { ViewExample.offered(tracked: tracked) }

    private var canChange: Bool { SidebarActions(model: model).canChange }

    private var canSave: Bool {
        canChange && !busy && !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Whether the fields differ from how they started, so that a swipe
    /// does not lose them.
    private var changed: Bool {
        switch purpose {
        case .edit(let view): name != view.name || query != view.query
        case .duplicate(let view): name != "\(view.name) copy" || query != view.query
        case .new, nil: !name.isEmpty || !query.isEmpty
        }
    }

    private var removalTitle: String {
        if case .edit(let view) = purpose { return ManagedEntry.view(view).removalTitle }
        return ""
    }

    // MARK: Acting

    /// Fills the fields for what the editor is open for. The keyboard then
    /// goes to the field to type in first: a new view's name, a duplicate's
    /// name, selected to be typed over, or the end of an edited view's search.
    private func start() {
        guard purpose == nil else { return }
        if let editing {
            purpose = .edit(editing)
            name = editing.name
            query = editing.query
        } else if let original = model.duplicatedView {
            purpose = .duplicate(original)
            name = "\(original.name) copy"
            query = original.query
        } else {
            purpose = .new
            if let draft = SidebarLaunchOptions.draft {
                name = draft.name
                query = draft.query
            }
        }
        if SidebarLaunchOptions.savesAtOnce { save() }
    }

    /// A search holds no line breaks: Return leaves the field, and pasted
    /// lines become words.
    private func typed(_ current: String, after previous: String) {
        guard current.contains(where: \.isNewline) else { return }
        let returned = current.count == previous.count + 1 && current.last?.isNewline == true
        query = current.split(whereSeparator: \.isNewline).joined(separator: " ")
        outcome = nil
        if returned { focus = nil }
    }

    private func choose(_ snippet: QuerySnippet) {
        withAnimation(.snappy) {
            query = snippet.toggled(in: query)
            outcome = nil
        }
        if snippet.isOpen {
            // Its value is typed right after it, once the field has the keyboard.
            focus = .search
            Task {
                try? await Task.sleep(for: .milliseconds(100))
                querySelection = TextSelection(insertionPoint: query.endIndex)
            }
        }
    }

    private func use(_ example: ViewExample) {
        let applied = example.applied(to: name, query: query, offered: examples)
        withAnimation(.snappy) {
            name = applied.name
            query = applied.query
            outcome = nil
        }
    }

    private func save(force: Bool = false) {
        guard let core = model.core, let purpose, !busy else { return }
        var draft = ViewDraft(name: name, query: query)
        switch purpose {
        case .edit(let view): draft.id = view.id
        case .duplicate(let view): draft.after = view.id
        case .new: break
        }
        busy = true
        outcome = nil
        focus = nil
        Task {
            let result: ViewSave
            do {
                result = try await core.saveView(draft, force: force)
            } catch {
                result = .failed(message: error.localizedDescription)
            }
            busy = false
            switch result {
            case .saved(let view):
                saved += 1
                model.select(.view(id: view.id))
                dismiss()
            case .rejected(let message):
                outcome = .rejected(message)
            case .unchecked(let problem):
                outcome = .unchecked(problem)
            case .failed(let message):
                outcome = .failed(message)
            }
        }
    }

    private func remove() {
        guard case .edit(let view) = purpose else { return }
        busy = true
        Task {
            let removed = await SidebarActions(model: model).remove(.view(view))
            busy = false
            if removed { dismiss() }
        }
    }
}

/// Says what a search covers, from its `repo:`, `org:` and `user:`
/// qualifiers alone, warns when it combines repositories so that it matches
/// nothing, and says that Save checks it with GitHub.
private struct ScopeLine: View {
    @Environment(\.palette) private var palette
    var query: String
    var busy: Bool

    var body: some View {
        let scope = ViewScope(query: query)
        VStack(alignment: .leading, spacing: 6) {
            if let warning = scope.warning {
                Label(warning, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(palette.warning)
            }
            Label(scope.description, systemImage: scope.targets == nil ? "globe" : "scope")
            Label(
                busy ? "Checking the search with GitHub…" : "Save runs the search once, to check it with GitHub.",
                systemImage: busy ? "hourglass" : "checkmark.seal")
        }
        .font(.footnote)
        .foregroundStyle(palette.muted)
        .fixedSize(horizontal: false, vertical: true)
        .animation(.smooth, value: scope)
        .padding(.top, 4)
    }
}

/// Why Save did not save, and what can be done about it.
private struct SaveProblem: View {
    @Environment(\.palette) private var palette
    var outcome: ViewEditorView.Outcome
    var busy: Bool
    var saveAnyway: () -> Void
    var tryAgain: () -> Void

    var body: some View {
        switch outcome {
        case .rejected(let message):
            VStack(alignment: .leading, spacing: 6) {
                Label("GitHub rejected this search", systemImage: "xmark.octagon.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(palette.destructive)
                Text(message)
                    .font(.footnote)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.vertical, 4)
        case .failed(let message):
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.footnote)
                .foregroundStyle(palette.destructive)
                .fixedSize(horizontal: false, vertical: true)
        case .unchecked(let problem):
            VStack(alignment: .leading, spacing: 8) {
                Label(
                    {
                        if case .unreachable = problem { return "Couldn’t reach GitHub to check this search" }
                        return "GitHub returned an error while checking this search"
                    }(),
                    systemImage: "wifi.exclamationmark"
                )
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(palette.warning)
                Text(ReasonText(problem).full)
                    .font(.footnote)
                    .foregroundStyle(palette.muted)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 8) {
                    Button("Save Anyway", action: saveAnyway)
                    Button("Try Again", action: tryAgain)
                }
                .buttonStyle(.glass)
                .controlSize(.small)
                .disabled(busy)
            }
            .padding(.vertical, 4)
        }
    }
}
