import AppKit
import SwiftUI
import VerdandiCore

/// All, the tracked repositories and the views, each section with a button
/// to add to it. Entries are reordered by dragging, removed by their context
/// menu or ⌫ after confirming, and selected by ⌘1…⌘9 in visual order,
/// which the entries show while ⌘ is held.
struct SidebarView: View {
  @Environment(AppModel.self) private var model
  @State private var showsShortcuts = LaunchOptions.environment["VERDANDI_SHORTCUTS"] == "1"
  @State private var shortcutDelay: Task<Void, Never>?

  var body: some View {
    let sidebar = model.sidebar
    entryList
      .listStyle(.sidebar)
      .navigationTitle("Verdandi")
      .contextMenu(forSelectionType: SidebarItem.self) { items in
        SidebarMenu(items: items)
      } primaryAction: { items in
        // Double-click or Return on a view edits it.
        if items.count == 1, case .view(let id) = items.first, sidebar.canChange { sidebar.edit(id) }
      }
      .onDeleteCommand { sidebar.requestRemoval(model.selection) }
      .confirmationDialog(
        removalTitle, isPresented: removalShown, titleVisibility: .visible, presenting: sidebar.pendingRemoval
      ) { (item: SidebarItem) in
        Button("Remove", role: .destructive) { sidebar.remove(item) }
        Button("Cancel", role: .cancel) {}
      } message: { (item: SidebarItem) in
        Text(removalMessage(item))
      }
      .onModifierKeysChanged(mask: [.command, .shift, .option, .control]) { (_: EventModifiers, keys: EventModifiers) in
        commandHeld(keys == .command)
      }
      .background { EntryShortcuts(select: sidebar.selectEntry(at:)) }
      .safeAreaInset(edge: .bottom, spacing: 0) { SidebarFooter() }
      .animation(.smooth, value: sidebar.repositories)
      .animation(.smooth, value: sidebar.views)
      .task(id: CountsKey(model.settings)) { await sidebar.refreshUnknown() }
      .task {
        sidebar.watchSettings()
        SidebarLaunchOptions.apply(to: model)
        await sidebar.revalidate()
      }
  }

  /// The entries: All, then the Repositories and Views sections.
  private var entryList: some View {
    @Bindable var model = model
    let sidebar = model.sidebar
    let positions = shortcutPositions
    return List(selection: $model.selection) {
      AllRow(shortcut: positions[.all])
        .tag(SidebarItem.all)

      Section {
        ForEach(sidebar.repositories) { (repository: TrackedRepository) in
          RepositoryRow(repository: repository, shortcut: positions[.repository(repository.address)])
            .tag(SidebarItem.repository(repository.address))
        }
        .onMove { source, destination in sidebar.moveRepositories(fromOffsets: source, toOffset: destination) }
        .moveDisabled(!sidebar.canChange)
        if sidebar.repositories.isEmpty {
          EmptySectionRow(title: "Add Repositories…") { sidebar.showRepositoryPicker() }
        }
      } header: {
        SectionHeader(title: "Repositories", addLabel: "Add Repositories…") { sidebar.showRepositoryPicker() }
      }

      Section {
        ForEach(sidebar.views) { (view: SavedView) in
          ViewRow(view: view, shortcut: positions[.view(id: view.id)])
            .tag(SidebarItem.view(id: view.id))
        }
        .onMove { source, destination in sidebar.moveViews(fromOffsets: source, toOffset: destination) }
        .moveDisabled(!sidebar.canChange)
        if sidebar.views.isEmpty {
          EmptySectionRow(title: "New View…") { sidebar.newView() }
        }
      } header: {
        SectionHeader(title: "Views", addLabel: "New View…") { sidebar.newView() }
      }
    }
  }

  /// Each entry's ⌘ shortcut, 1 to 9 in visual order, while they show.
  private var shortcutPositions: [SidebarItem: Int] {
    guard showsShortcuts else { return [:] }
    var positions: [SidebarItem: Int] = [:]
    for (index, item) in model.sidebar.entries.prefix(9).enumerated() where positions[item] == nil {
      positions[item] = index + 1
    }
    return positions
  }

  /// Shows the entries' shortcuts once ⌘ alone is held a moment, so that a
  /// quick ⌘C does not flash them.
  private func commandHeld(_ held: Bool) {
    shortcutDelay?.cancel()
    guard held else {
      withAnimation(.smooth(duration: 0.2)) { showsShortcuts = false }
      return
    }
    shortcutDelay = Task {
      try? await Task.sleep(for: .milliseconds(350))
      guard !Task.isCancelled else { return }
      withAnimation(.smooth(duration: 0.2)) { showsShortcuts = true }
    }
  }

  private var removalShown: Binding<Bool> {
    Binding(
      get: { model.sidebar.pendingRemoval != nil },
      set: { if !$0 { model.sidebar.pendingRemoval = nil } })
  }

  private var removalTitle: String {
    switch model.sidebar.pendingRemoval {
    case .repository(let address): "Remove \(address) from Verdandi?"
    case .view(let id): "Remove the view “\(model.view(id: id)?.name ?? "")”?"
    case .all, nil: ""
    }
  }

  private func removalMessage(_ item: SidebarItem) -> String {
    switch item {
    case .repository:
      "Nothing on GitHub changes. Its issues leave All; views are not changed. You can add it again at any time."
    case .view:
      "Its name and search are deleted from your settings. Tracked repositories and issues are not affected."
    case .all:
      ""
    }
  }
}

/// What the counts depend on: the tracked repositories and the views'
/// searches. A change reads the counts not known yet.
private struct CountsKey: Hashable {
  var repositories: [RepositoryAddress]
  var queries: [String]

  init(_ settings: VerdandiCore.Settings) {
    repositories = settings.repositories.map(\.address)
    queries = settings.views.map(\.query)
  }
}

/// A section's title, with a button that adds to it.
private struct SectionHeader: View {
  var title: String
  var addLabel: String
  var add: () -> Void
  @State private var hovering = false

  var body: some View {
    HStack {
      Text(title)
      Spacer()
      Button(addLabel, systemImage: "plus", action: add)
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .imageScale(.medium)
        .fontWeight(.medium)
        .foregroundStyle(hovering ? .primary : .secondary)
        .help(addLabel)
        .onHover { hovering = $0 }
        .padding(.trailing, 6)
    }
  }
}

/// A row in an empty section that offers to add to it.
private struct EmptySectionRow: View {
  var title: String
  var action: () -> Void

  var body: some View {
    Button(action: action) {
      Label(title, systemImage: "plus.circle")
        .foregroundStyle(.secondary)
    }
    .buttonStyle(.plain)
    .selectionDisabled()
  }
}

/// Invisible buttons that give ⌘1…⌘9 to the entries in visual order.
private struct EntryShortcuts: View {
  var select: (Int) -> Void

  var body: some View {
    ZStack {
      ForEach(0..<9, id: \.self) { position in
        Button("Select Entry \(position + 1)") { select(position) }
          .keyboardShortcut(KeyEquivalent(Character(String(position + 1))), modifiers: .command)
      }
    }
    .frame(width: 0, height: 0)
    .opacity(0)
    .accessibilityHidden(true)
  }
}
