import SwiftUI
import VerdandiKit

/// The sidebar: All, then the Repositories and Views sections, each with a
/// button that adds to it, and the account at its foot. Entries move by
/// dragging or by Move Up and Move Down in their context menu, and go by
/// swiping or Remove… once confirmed; ⌘1…9 choose them on a keyboard
/// (`SidebarCommands`). While the settings file cannot be written, a banner
/// says why and nothing changes. On the first launch the repository picker
/// opens on its own.
struct SidebarView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.palette) private var palette
    @Environment(\.openURL) private var openURL
    @Environment(\.horizontalSizeClass) private var sizeClass
    /// The entry whose removal waits to be confirmed.
    @State private var removal: ManagedEntry?
    /// Whether the first launch's picker was offered, so that closing it
    /// does not open it again until the next launch.
    @State private var offeredPicker = false
    /// Whether the launch options were applied, once the sidebar listed
    /// what they name.
    @State private var appliedLaunch = false
    // Count the moves and removals, to give each a haptic.
    @State private var moves = 0
    @State private var removals = 0

    private var actions: SidebarActions { SidebarActions(model: model) }

    var body: some View {
        List(selection: Binding(get: { model.selection }, set: { model.select($0) })) {
            switch model.sidebar {
            case .read(let entries):
                entryList(entries)
            case .failed(let message):
                failed(message)
            case nil:
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("Verdandi")
        // An iPad's sidebar names the app in its bar, where its toolbar
        // leaves the title room; an iPhone's opens with it large.
        .navigationBarTitleDisplayMode(sizeClass == .compact ? .automatic : .inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) { addMenu }
        }
        .safeAreaBar(edge: .bottom) { SidebarFooter() }
        .animation(.smooth, value: model.sidebar)
        .sensoryFeedback(.impact(flexibility: .soft), trigger: moves)
        .sensoryFeedback(.success, trigger: removals)
        .onChange(of: firstLaunch, initial: true) { _, first in offerPicker(first) }
        .onChange(of: model.sidebar, initial: true) { applyLaunchOptions() }
        .task { await SidebarLaunchOptions.showSidebar(model) }
    }

    // MARK: Entries

    @ViewBuilder
    private func entryList(_ entries: SidebarEntries.Read) -> some View {
        let canChange = entries.settings.isWritable
        Section {
            AllEntryRow(count: entries.all.openIssues)
                .tag(SidebarItem.all)
        }
        if !canChange {
            Section {
                SettingsProblemBanner(status: entries.settings)
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .selectionDisabled()
            }
        }
        Section {
            ForEach(Array(entries.repositories.enumerated()), id: \.element.repository.address) { index, entry in
                repositoryRow(entry, at: index, of: entries.repositories.count, canChange: canChange)
            }
            .onMove(perform: canChange ? moveRepositories(entries) : nil)
            if entries.repositories.isEmpty {
                AddEntryRow(title: "Add Repository…", disabled: !canChange) { actions.addRepository() }
            }
        } header: {
            SectionHeader(title: "Repositories", addTitle: "Add Repository", disabled: !canChange) {
                actions.addRepository()
            }
        }
        Section {
            ForEach(Array(entries.views.enumerated()), id: \.element.view.id) { index, entry in
                viewRow(entry, at: index, of: entries.views.count, canChange: canChange)
            }
            .onMove(perform: canChange ? moveViews(entries) : nil)
            if entries.views.isEmpty {
                AddEntryRow(title: "New View…", disabled: !canChange) { actions.newView() }
            }
        } header: {
            SectionHeader(title: "Views", addTitle: "New View", disabled: !canChange) { actions.newView() }
        }
    }

    private func repositoryRow(_ entry: RepositoryEntry, at index: Int, of count: Int, canChange: Bool) -> some View {
        let managed = ManagedEntry.repository(entry.repository)
        let address = entry.repository.address
        let takenOver = entry.nameTakenOver
        return RepositoryEntryRow(entry: entry, login: login)
            .tag(SidebarItem.repository(address))
            .contextMenu {
                if let unavailable = entry.unavailable {
                    Section(ReasonText(unavailable, login: login, repository: address).full) {
                        Button("Retry", systemImage: "arrow.clockwise") { Task { await actions.retry(address) } }
                        if takenOver {
                            Button("Track the New \(address.nameWithOwner)", systemImage: "arrow.triangle.2.circlepath") {
                                Task { await actions.trackNew(entry.repository) }
                            }
                            .disabled(!canChange)
                        }
                    }
                } else if case .failed(let message) = entry.openIssues {
                    Section(message) {
                        Button("Retry", systemImage: "arrow.clockwise") { Task { await actions.retry(address) } }
                    }
                }
                // Its address would open the repository that took it over.
                if !takenOver, let url = SidebarLinks.repository(address) {
                    Button("Open on GitHub", systemImage: "safari") { openURL(url) }
                }
                moveButtons(managed, at: index, of: count, canChange: canChange)
                Button("Remove Repository…", systemImage: "trash", role: .destructive) { removal = managed }
                    .disabled(!canChange)
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                if canChange {
                    Button("Remove", systemImage: "trash") { removal = managed }
                        .tint(palette.destructive)
                }
            }
            .swipeActions(edge: .leading) {
                if takenOver, canChange {
                    Button("Track New", systemImage: "arrow.triangle.2.circlepath") {
                        Task { await actions.trackNew(entry.repository) }
                    }
                    .tint(palette.accent)
                }
            }
            .modifier(RemovalConfirmation(entry: managed, removal: $removal) { remove(managed) })
    }

    private func viewRow(_ entry: ViewEntry, at index: Int, of count: Int, canChange: Bool) -> some View {
        let managed = ManagedEntry.view(entry.view)
        return ViewEntryRow(entry: entry)
            .tag(SidebarItem.view(id: entry.view.id))
            .contextMenu {
                if case .rejected(let message) = entry.matches {
                    Section("GitHub rejected this search: \(message)") {}
                }
                Button("Edit View…", systemImage: "pencil") { actions.edit(entry.view) }
                Button("Duplicate View…", systemImage: "plus.square.on.square") { actions.duplicate(entry.view) }
                    .disabled(!canChange)
                if let url = SidebarLinks.search(entry.view) {
                    Button("Open on GitHub", systemImage: "safari") { openURL(url) }
                }
                moveButtons(managed, at: index, of: count, canChange: canChange)
                Button("Remove View…", systemImage: "trash", role: .destructive) { removal = managed }
                    .disabled(!canChange)
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                if canChange {
                    Button("Remove", systemImage: "trash") { removal = managed }
                        .tint(palette.destructive)
                }
            }
            .swipeActions(edge: .leading) {
                Button("Edit", systemImage: "pencil") { actions.edit(entry.view) }
                    .tint(palette.accent)
            }
            .modifier(RemovalConfirmation(entry: managed, removal: $removal) { remove(managed) })
    }

    @ViewBuilder
    private func moveButtons(_ entry: ManagedEntry, at index: Int, of count: Int, canChange: Bool) -> some View {
        Section {
            Button("Move Up", systemImage: "arrow.up") { move(entry, by: -1) }
                .disabled(!canChange || index == 0)
            Button("Move Down", systemImage: "arrow.down") { move(entry, by: 1) }
                .disabled(!canChange || index >= count - 1)
        }
    }

    private func failed(_ message: String) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Label("The sidebar can’t be read", systemImage: "exclamationmark.triangle.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(palette.warning)
                Text(message)
                    .font(.footnote)
                    .textSelection(.enabled)
                Button("Reload", systemImage: "arrow.clockwise") { Task { await actions.reloadSettings() } }
                    .buttonStyle(.glass)
                    .controlSize(.small)
            }
            .padding(.vertical, 4)
            .selectionDisabled()
        }
    }

    // MARK: Adding

    private var addMenu: some View {
        Menu {
            Button("Add Repository…", systemImage: "book.closed") { actions.addRepository() }
            Button("New View…", systemImage: "line.3.horizontal.decrease.circle") { actions.newView() }
        } label: {
            Label("Add", systemImage: "plus")
        }
        .disabled(!actions.canChange)
    }

    // MARK: Changing

    private func moveRepositories(_ entries: SidebarEntries.Read) -> (IndexSet, Int) -> Void {
        let keys = entries.repositories.map { SidebarEntryKey.repository($0.repository.address) }
        return { source, destination in
            moves += 1
            Task { await actions.move(keys, from: source, to: destination) }
        }
    }

    private func moveViews(_ entries: SidebarEntries.Read) -> (IndexSet, Int) -> Void {
        let keys = entries.views.map { SidebarEntryKey.view(id: $0.view.id) }
        return { source, destination in
            moves += 1
            Task { await actions.move(keys, from: source, to: destination) }
        }
    }

    private func move(_ entry: ManagedEntry, by step: Int) {
        moves += 1
        Task { await actions.move(entry, by: step) }
    }

    private func remove(_ entry: ManagedEntry) {
        Task {
            if await actions.remove(entry) { removals += 1 }
        }
    }

    // MARK: State

    private var login: String? { model.setup.account?.login }

    private var firstLaunch: Bool {
        if case .read(let entries) = model.sidebar { return entries.firstLaunch }
        return false
    }

    /// Opens the repository picker on the first launch, once: Skip or
    /// adding a repository creates the settings file, so that it does not
    /// open again; closed any other way, it opens again on the next launch.
    private func offerPicker(_ first: Bool) {
        guard first, !offeredPicker else { return }
        offeredPicker = true
        // A launch for development that tracks repositories or saves a
        // view sets the profile up itself.
        guard model.launch.track.isEmpty, model.launch.view == nil else { return }
        if model.sheet == nil { model.sheet = .repositoryPicker }
    }

    private func applyLaunchOptions() {
        guard !appliedLaunch, case .read(let entries) = model.sidebar else { return }
        let removal = SidebarLaunchOptions.removal(in: entries)
        let editing = SidebarLaunchOptions.editedViewName ?? SidebarLaunchOptions.duplicatedViewName
        // The launch saves the views it names after the first read.
        if editing != nil, !entries.views.contains(where: { $0.view.name == editing }) { return }
        if ProcessInfo.processInfo.environment["VERDANDI_REMOVE"] != nil, removal == nil { return }
        appliedLaunch = true
        SidebarLaunchOptions.openEditor(in: entries, with: actions)
        if let removal {
            Task {
                try? await Task.sleep(for: .seconds(1))
                self.removal = removal
            }
        }
    }
}

fileprivate extension RepositoryEntry {
    /// Whether its name now belongs to a different repository, while the
    /// one tracked cannot be read.
    var nameTakenOver: Bool {
        if case .unavailable(_, _, true)? = unavailable { return true }
        return false
    }
}

/// A section's title, with the button that adds to it.
private struct SectionHeader: View {
    var title: String
    var addTitle: String
    var disabled: Bool
    var add: () -> Void

    var body: some View {
        HStack {
            Text(title)
            Spacer()
            Button(addTitle, systemImage: "plus", action: add)
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
                .fontWeight(.semibold)
                .imageScale(.medium)
                .hoverEffect()
                .disabled(disabled)
                .help(addTitle)
        }
    }
}

/// A row in an empty section that offers to add to it, while it can be
/// added to.
private struct AddEntryRow: View {
    var title: String
    var disabled: Bool
    var action: () -> Void

    var body: some View {
        if !disabled {
            Button(action: action) {
                Label(title, systemImage: "plus.circle.fill")
                    .foregroundStyle(.tint)
            }
            .selectionDisabled()
        }
    }
}

/// Asks to confirm removing an entry, from the entry's own row, saying what
/// stays: the removal of a sidebar entry always goes through it.
private struct RemovalConfirmation: ViewModifier {
    var entry: ManagedEntry
    @Binding var removal: ManagedEntry?
    var remove: () -> Void

    func body(content: Content) -> some View {
        content.confirmationDialog(
            entry.removalTitle,
            isPresented: Binding(get: { removal?.id == entry.id }, set: { if !$0 { removal = nil } }),
            titleVisibility: .visible
        ) {
            Button("Remove", role: .destructive, action: remove)
        } message: {
            Text(entry.removalMessage)
        }
    }
}
