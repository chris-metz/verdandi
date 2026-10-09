import SwiftUI
import VerdandiKit

/// The issues of a scope's list or a view, as a forest of rows: tapping one
/// opens its issue page, beside the list on an iPad, where the selection
/// shows, or over it on an iPhone. Notices above the issues say what the
/// list leaves out; the line below them counts it. The label filter floats
/// at the bottom while the list has one.
struct ForestList<Notices: View, Footer: View>: View {
    @Environment(AppModel.self) private var model
    @Environment(\.palette) private var palette
    let rows: [ListRow]
    let style: RowStyle
    let controller: ListController
    let labelFilter: [IssueLabel]
    @ViewBuilder var notices: () -> Notices
    @ViewBuilder var footer: () -> Footer

    var body: some View {
        let selected = model.selectedIssue?.id
        List(selection: selection) {
            notices()
            ForEach(rows) { row in
                IssueListRow(row: row, style: style, controller: controller)
                    .equatable()
                    .contextMenu { IssueRowMenu(row: row, controller: controller) }
                    .modifier(IssueRowSwipes(row: row, controller: controller))
                    .listRowInsets(EdgeInsets(top: 0, leading: 4, bottom: 0, trailing: 16))
                    .listRowSeparatorTint(palette.border)
                    .listRowSeparator(.hidden, edges: .top)
                    // The theme's background, as around the list; the
                    // system's on the selected row, so that it draws the
                    // selection as an iPad does, filled when the list has
                    // the keyboard.
                    .listRowBackground(row.id == selected ? nil : palette.background)
                    .tag(row.id)
                    .selectionDisabled(row.kind != .issue)
            }
            footer()
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(palette.background)
        .safeAreaBar(edge: .bottom) {
            // Always there, so that the bar slides in and out with the
            // label filter, while the rows change without animation: a
            // list of a large repository is too long to animate.
            VStack {
                if !labelFilter.isEmpty {
                    LabelFilterBar(
                        labels: labelFilter, remove: { controller.removeFromFilter($0.name) },
                        clear: { controller.clearFilter() }
                    )
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.snappy, value: labelFilter.isEmpty)
        }
        .background { KeyboardShortcuts(controller: controller) }
        .sensoryFeedback(.selection, trigger: labelFilter)
        .sensoryFeedback(.impact(weight: .light), trigger: controller.expansions)
        .sensoryFeedback(.success, trigger: controller.copies)
    }

    /// The issue shown beside or over the list, by its ID, so that it
    /// shows selected however the place it was opened from named it.
    private var selection: Binding<String?> {
        Binding {
            model.selectedIssue?.id
        } set: { id in
            guard let id else {
                model.selectedIssue = nil
                return
            }
            guard let row = controller.forest.row(id), row.kind == .issue else { return }
            model.openIssue(IssueRoute(row.issue))
        }
    }
}

/// What a hardware keyboard does in a list, on an iPad, where holding ⌘
/// lists it. The buttons are out of sight; the menus offer the same.
private struct KeyboardShortcuts: View {
    let controller: ListController

    var body: some View {
        Group {
            Button("Refresh") { Task { await controller.refresh { false } } }
                .keyboardShortcut("r")
            Button("Expand All") { controller.setAllExpanded(true) }
                .keyboardShortcut(.rightArrow, modifiers: [.command, .option])
            Button("Collapse All") { controller.setAllExpanded(false) }
                .keyboardShortcut(.leftArrow, modifiers: [.command, .option])
        }
        .opacity(0)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
