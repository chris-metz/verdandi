import SwiftUI
import VerdandiCore

/// A sidebar entry's list: its matches, each under its parent issue, with
/// the context issues needed to place them. Selecting a row opens its issue
/// in the detail column.
///
/// Keys, while the list has focus: `j`/`k` and ↑/↓ move, ←/→ collapse and
/// expand (← on a sub-issue goes to its parent issue), `e` expands or
/// collapses everything, Esc clears the label filter, `r` refreshes, `s`
/// switches between open and closed, `o` opens the issue on GitHub.
struct IssueListView: View {
  @Environment(AppModel.self) private var model
  var item: SidebarItem

  var body: some View {
    IssueListContent(list: model.lists.list(for: item))
  }
}

private struct IssueListContent: View {
  @Environment(AppModel.self) private var model
  @Environment(\.openURL) private var openURL
  var list: IssueListModel
  @FocusState private var focused: Bool

  var body: some View {
    @Bindable var model = model
    let forest = list.forest
    ScrollViewReader { scroller in
      List(selection: $model.selectedIssueID) {
        if list.hasLoaded {
          ForestRows(nodes: forest.trees, list: list)
        } else if list.isLoading || list.failure == nil {
          SkeletonRows()
        }
      }
      .focused($focused)
      .onKeyPress { press in
        handle(press, forest: forest)
      }
      .onChange(of: model.selectedIssueID) { _, id in
        // Reveal the selection, wherever it was made: a key, the issue page.
        if let id { withAnimation(.smooth) { scroller.scrollTo(id) } }
      }
      .onChange(of: list.labelFilter) {
        // Keep the selection in sight as the list narrows or widens.
        if let id = model.selectedIssueID { scroller.scrollTo(id, anchor: .center) }
      }
      .task(id: list.loadKey) {
        await list.load()
        await ListLaunchOptions.applyOnceLoaded(to: list, model: model, scroller: scroller)
      }
    }
    .overlay { ListPlaceholder(list: list, forest: forest) }
    .safeAreaBar(edge: .top) { ListHeader(list: list) }
    .scrollEdgeEffectStyle(.hard, for: .top)
    .safeAreaBar(edge: .bottom) { ListStatusBar(list: list, forest: forest) }
    .navigationTitle(list.title)
    .navigationSubtitle(list.subtitle(forest))
    .onChange(of: list.isSettled ? forest.missingShown : [], initial: true) { _, ids in
      list.readMissing(ids)
    }
    .onAppear {
      // The first list takes the keyboard as the app opens; later ones leave
      // it where it is, e.g. in the sidebar as the user moves through it.
      if !model.lists.hasFocusedAList || ListLaunchOptions.areFor(list) {
        model.lists.hasFocusedAList = true
        focused = true
      }
    }
  }

  /// What a key does in the list.
  private func handle(_ press: KeyPress, forest: Forest) -> KeyPress.Result {
    guard press.modifiers.isDisjoint(with: [.command, .control, .option]) else { return .ignored }
    let rows = forest.visibleRows
    let index = rows.firstIndex { $0.id == model.selectedIssueID }
    let row = index.map { rows[$0] }

    func select(_ target: ForestRow?) -> KeyPress.Result {
      guard let target else { return .handled }
      model.selectedIssueID = target.id
      return .handled
    }

    switch press.key {
    case .escape:
      guard !list.labelFilter.isEmpty else { return .ignored }
      withAnimation(.smooth) { list.clearLabelFilter() }
      return .handled
    case .leftArrow:
      guard let row else { return .ignored }
      if row.node.isExpanded && !row.node.subIssues.isEmpty {
        withAnimation(.smooth) { list.setExpanded(row.id, false) }
        return .handled
      }
      return select(row.parentID.flatMap { id in rows.first { $0.id == id } })
    case .rightArrow:
      guard let row, let index, !row.node.subIssues.isEmpty else { return .ignored }
      if !row.node.isExpanded {
        withAnimation(.smooth) { list.setExpanded(row.id, true) }
        return .handled
      }
      return select(rows[safe: index + 1])
    default:
      break
    }

    switch press.characters {
    case "j":
      return select(index.map { rows[safe: $0 + 1] } ?? rows.first)
    case "k":
      return select(index.map { rows[safe: $0 - 1] } ?? rows.last)
    case "r":
      Task { await list.refresh() }
      return .handled
    case "s":
      guard !list.isView else { return .ignored }
      list.toggleState()
      return .handled
    case "e":
      let expandable = forest.allNodes.filter { !$0.subIssues.isEmpty }
      guard !expandable.isEmpty else { return .handled }
      withAnimation(.smooth) { list.setEverythingExpanded(expandable.contains { !$0.isExpanded }) }
      return .handled
    case "o":
      if let url = row?.node.webURL { openURL(url) }
      return .handled
    default:
      return .ignored
    }
  }
}

/// The rows of a forest: each issue, and below one with sub-issues a
/// disclosure group of theirs.
private struct ForestRows: View {
  var nodes: [ForestNode]
  var list: IssueListModel

  var body: some View {
    ForEach(nodes) { node in
      if node.subIssues.isEmpty {
        row(node)
      } else {
        DisclosureGroup(isExpanded: expansion(of: node)) {
          ForestRows(nodes: node.subIssues, list: list)
        } label: {
          row(node)
        }
      }
    }
  }

  private func row(_ node: ForestNode) -> some View {
    var shown = node
    shown.subIssues = []
    return IssueRow(node: shown, naming: list.naming, listState: list.isView ? nil : list.state, list: list)
      .tag(node.id)
  }

  private func expansion(of node: ForestNode) -> Binding<Bool> {
    Binding(get: { node.isExpanded }, set: { list.setExpanded(node.id, $0) })
  }
}

extension IssueListModel {
  /// How its rows name repositories.
  var naming: RepositoryNaming {
    var own: RepositoryAddress?
    if case .repository(let address) = item { own = address }
    return RepositoryNaming(own: own, tracked: lists.model.settings.repositories.map(\.address))
  }
}

extension Array {
  fileprivate subscript(safe index: Int) -> Element? {
    indices.contains(index) ? self[index] : nil
  }
}
