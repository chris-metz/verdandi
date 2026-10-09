import SwiftUI
import VerdandiKit

/// A piece of search the view editor offers to add, e.g. `assignee:@me`,
/// or a qualifier to finish, e.g. `label:`.
struct QuerySnippet: Identifiable, Hashable {
    var text: String
    /// What it finds, for VoiceOver and the pointer.
    var help: String
    /// Snippets that cannot hold together with this one, e.g. `is:open`
    /// and `is:closed`: adding it removes them.
    var excludes: [String] = []

    var id: String { text }

    /// Whether it is a qualifier still to be given its value, which is
    /// typed after it.
    var isOpen: Bool { text.hasSuffix(":") }

    /// The snippets offered, naming the tracked repositories and their
    /// owners where one names a repository or an owner.
    static func offered(tracked: [RepositoryAddress]) -> [QuerySnippet] {
        var snippets = [
            QuerySnippet(text: "is:open", help: "Open issues only", excludes: ["is:closed"]),
            QuerySnippet(text: "is:closed", help: "Closed issues only", excludes: ["is:open"]),
            QuerySnippet(text: "is:issue", help: "Issues only, without pull requests"),
            QuerySnippet(text: "assignee:@me", help: "Assigned to you", excludes: ["no:assignee"]),
            QuerySnippet(text: "author:@me", help: "Opened by you"),
            QuerySnippet(text: "mentions:@me", help: "Mentioning you"),
            QuerySnippet(text: "no:assignee", help: "Assigned to no one", excludes: ["assignee:@me"]),
            QuerySnippet(text: "label:", help: "Carrying a label: type its name"),
            QuerySnippet(text: "-label:", help: "Not carrying a label: type its name"),
            QuerySnippet(text: "no:label", help: "Carrying no label"),
            QuerySnippet(text: "is:blocked", help: "Blocked by an open issue"),
            QuerySnippet(text: "has:sub-issue", help: "Parent issues: those with sub-issues"),
        ]
        let repositories = tracked.prefix(2)
        for repository in repositories {
            let name = repository.nameWithOwner
            snippets.append(QuerySnippet(text: "repo:\(name)", help: "In \(name) only"))
        }
        if repositories.isEmpty {
            snippets.append(QuerySnippet(text: "repo:", help: "In one repository only: type its owner/name"))
        }
        var owners: [String] = []
        for repository in tracked where !owners.contains(where: { $0.lowercased() == repository.owner.lowercased() }) {
            owners.append(repository.owner)
        }
        for owner in owners.prefix(2) {
            snippets.append(QuerySnippet(text: "org:\(owner)", help: "In \(owner)’s repositories only"))
        }
        if owners.isEmpty {
            snippets.append(QuerySnippet(text: "org:", help: "In one organization’s repositories only: type its name"))
        }
        snippets.append(QuerySnippet(text: "sort:updated-desc", help: "Recently updated first"))
        return snippets
    }

    /// Whether the search holds this snippet as a term of its own.
    func isIn(_ query: String) -> Bool {
        !isOpen && Self.terms(of: query).contains { $0.lowercased() == text.lowercased() }
    }

    /// The search with this snippet removed if it holds it, otherwise added
    /// at the end, without those it excludes. A qualifier to finish is
    /// always added, for its value to be typed after it.
    func toggled(in query: String) -> String {
        var terms = Self.terms(of: query)
        if isIn(query) {
            terms.removeAll { $0.lowercased() == text.lowercased() }
            return terms.joined(separator: " ")
        }
        // A qualifier chosen twice before its value was typed goes again.
        if isOpen, terms.last?.lowercased() == text.lowercased() {
            terms.removeLast()
            return terms.joined(separator: " ")
        }
        let excluded = Set(excludes.map { $0.lowercased() })
        terms.removeAll { excluded.contains($0.lowercased()) }
        terms.append(text)
        return terms.joined(separator: " ")
    }

    private static func terms(of query: String) -> [String] {
        query.split(whereSeparator: \.isWhitespace).map(String.init)
    }
}

/// The snippets as glass chips that add themselves to the search, or
/// remove themselves once in it.
struct SnippetChips: View {
    @Environment(\.palette) private var palette
    var query: String
    var snippets: [QuerySnippet]
    var choose: (QuerySnippet) -> Void

    var body: some View {
        GlassEffectContainer(spacing: 6) {
            FlowLayout(spacing: 8, lineSpacing: 8) {
                ForEach(snippets) { snippet in
                    chip(snippet)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func chip(_ snippet: QuerySnippet) -> some View {
        let isOn = snippet.isIn(query)
        return Button {
            choose(snippet)
        } label: {
            HStack(spacing: 4) {
                Image(systemName: isOn ? "checkmark" : snippet.isOpen ? "text.cursor" : "plus")
                    .font(.caption2.weight(.bold))
                    .contentTransition(.symbolEffect(.replace))
                Text(snippet.text)
                    .font(.footnote.monospaced())
                    .lineLimit(1)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .foregroundStyle(isOn ? AnyShapeStyle(.white) : AnyShapeStyle(palette.foreground))
            .glassEffect(isOn ? .regular.tint(palette.accent).interactive() : .regular.interactive(), in: .capsule)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .help(snippet.help)
        .accessibilityLabel(snippet.text)
        .accessibilityValue(snippet.help)
        .accessibilityHint(isOn ? "Removes it from the search" : "Adds it to the search")
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

/// A search the view editor suggests whole, with a name for the view and
/// what it finds, as the desktop's view dialog suggests them.
struct ViewExample: Identifiable, Hashable {
    var name: String
    var query: String
    var description: String

    var id: String { query }

    /// The examples, naming the first tracked repositories where a search
    /// names one, or placeholders while none is tracked.
    static func offered(tracked: [RepositoryAddress]) -> [ViewExample] {
        let first = tracked.first ?? RepositoryAddress(owner: "owner", name: "repo")
        let other = tracked.dropFirst().first ?? RepositoryAddress(owner: first.owner, name: "other")
        let one = first.nameWithOwner
        let two = other.nameWithOwner
        return [
            ViewExample(
                name: "Assigned to me", query: "is:open assignee:@me",
                description: "Open issues assigned to you, in any repository"),
            ViewExample(name: "Open in \(first.name)", query: "repo:\(one) is:open", description: "Open issues in one repository"),
            ViewExample(
                name: "\(first.name) and \(other.name)", query: "(repo:\(one) OR repo:\(two)) is:open",
                description: "Several repositories need OR"),
            ViewExample(
                name: "Blocked in \(first.owner)", query: "org:\(first.owner) is:open is:blocked",
                description: "Open issues with an open blocker, in one organization"),
            ViewExample(name: "Parent issues", query: "is:open has:sub-issue", description: "Issues that have sub-issues"),
            ViewExample(
                name: "Sub-issues of \(first.name)#1", query: "parent-issue:\(one)#1",
                description: "The sub-issues of one issue"),
            ViewExample(
                name: "Unassigned bugs", query: "is:open label:bug no:assignee sort:updated-desc",
                description: "sort: decides which 1,000 load when there are more"),
        ]
    }

    /// The fields once the example is chosen: its search replaces the
    /// search, and its name fills the name if it is empty, or still the
    /// name of the example whose search it replaces.
    func applied(to name: String, query: String, offered: [ViewExample]) -> (name: String, query: String) {
        let named =
            name.trimmingCharacters(in: .whitespaces).isEmpty
            || offered.contains { $0.name == name && $0.query == query }
        return (named ? self.name : name, self.query)
    }
}
