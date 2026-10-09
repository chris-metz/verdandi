import Foundation
import VerdandiKit

/// What a launch for development asks of the first list or view shown, as
/// environment variables beside those of `LaunchOptions`, so that its
/// states can be photographed without tapping to them:
///
/// - `VERDANDI_STATE`: `closed`, to switch the list to its closed issues.
/// - `VERDANDI_LABELS`: `bug,needs-triage`, labels of its issues to add to
///   its label filter, once they have loaded.
/// - `VERDANDI_EXPAND`: `all` or `none`, to expand or collapse every issue.
@MainActor
enum ListLaunchOptions {
    private static var applied = false

    /// Applies the options to the list once per launch, waiting for it to
    /// load as far as they need.
    static func apply(to controller: ListController, model: AppModel) async {
        let environment = ProcessInfo.processInfo.environment
        let state = environment["VERDANDI_STATE"].flatMap(IssueState.init(rawValue:))
        let labels = (environment["VERDANDI_LABELS"] ?? "").split(separator: ",").map {
            $0.trimmingCharacters(in: .whitespaces).lowercased()
        }
        let expand = environment["VERDANDI_EXPAND"]
        guard !applied, state != nil || !labels.isEmpty || expand != nil, model.core != nil else { return }
        // All may show for a moment before the launch selects its entry.
        if let selected = model.launch.select, selected.expandableList != controller.list { return }
        applied = true

        if let state, case .scope(let scope) = controller.list {
            await model.switchState(scope, to: state)
        }
        guard !labels.isEmpty || expand != nil else { return }
        // Until the list has loaded in its state, its issues lack their labels.
        var trees: [IssueNode] = []
        for _ in 0..<240 {
            if let loaded = loadedTrees(of: controller.list, in: state, model: model) {
                trees = loaded
                break
            }
            try? await Task.sleep(for: .milliseconds(250))
        }
        var found: [String: IssueLabel] = [:]
        func visit(_ node: IssueNode) {
            for label in node.issue.labels ?? [] where labels.contains(label.name.lowercased()) {
                found[label.name.lowercased()] = label
            }
            node.subIssues.forEach(visit)
        }
        trees.forEach(visit)
        for name in labels {
            if let label = found[name] { controller.filter(by: label) }
        }
        if let expand { controller.setAllExpanded(expand == "all") }
    }

    private static func loadedTrees(of list: ExpandableList, in state: IssueState?, model: AppModel) -> [IssueNode]? {
        switch list {
        case .scope(let scope):
            guard let list = model.list(for: scope), list.loading.state.updatedAt != nil,
                state == nil || list.state == state
            else { return nil }
            return list.trees
        case .view(let id):
            guard let view = model.views[id], view.loading.updatedAt != nil, !view.readingContext else { return nil }
            return view.trees
        }
    }
}
