import SwiftUI
import VerdandiKit

/// Adding tracked repositories: those the account reaches, suggested by the
/// core as their pages arrive, filtered by what is typed and by owner, or
/// any other by its exact `owner/name` or link, which is checked on GitHub.
/// Several are checked and added at once; those that could not be added
/// stay checked, each with why, and once every one is added the picker
/// closes. On the first launch it offers **Skip**, which keeps it from
/// opening on its own again.
struct RepositoryPickerView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette
    @State private var picker = RepositoryPickerModel(text: SidebarLaunchOptions.pickerSearch)
    /// Whether it opened on the first launch, as it was when it opened:
    /// adding creates the settings file.
    @State private var firstLaunch: Bool?
    @State private var added = 0

    var body: some View {
        NavigationStack {
            List {
                notes
                if !rows.typed.isEmpty {
                    Section("Typed Address") {
                        ForEach(rows.typed) { row in rowView(row) }
                    }
                }
                if !rows.suggested.isEmpty {
                    Section {
                        ForEach(rows.suggested) { row in rowView(row) }
                    } header: {
                        suggestionsHeader
                    }
                }
            }
            .listSectionSpacing(.compact)
            .overlay { emptyState }
            .animation(.smooth, value: rows)
            .navigationTitle("Add Repositories")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(
                text: $picker.text, placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Filter, or type owner/name or a link"
            )
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .keyboardType(.asciiCapable)
            .onSubmit(of: .search) { add() }
            .safeAreaBar(edge: .top) {
                if suggestions.owners.count > 1 {
                    OwnerFilter(owners: suggestions.owners, owner: $picker.owner)
                }
            }
            .safeAreaBar(edge: .bottom) { footer }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if firstLaunch == true {
                        Button("Skip") { skip() }
                            .disabled(picker.busy != nil)
                    } else {
                        Button("Cancel", systemImage: "xmark", role: .cancel) { dismiss() }
                    }
                }
            }
        }
        .interactiveDismissDisabled(picker.busy != nil)
        .sensoryFeedback(.selection, trigger: picker.selected.count)
        .sensoryFeedback(.success, trigger: added)
        .onChange(of: suggestions.repositories.count) {
            picker.check(SidebarLaunchOptions.pickerSelection, in: suggestions.repositories)
        }
        .task(id: TypedKey(text: picker.text, suggested: typedIsSuggested)) {
            guard let core = model.core else { return }
            await picker.checkTyped(suggestions.repositories, with: core)
        }
        .onAppear {
            if firstLaunch == nil { firstLaunch = SidebarActions(model: model).entries?.firstLaunch ?? false }
            guard let core = model.core else { return }
            Task { await model.attempt { try await core.openRepositoryPicker() } }
        }
        .onDisappear {
            // Its pages not yet asked for are dropped, and the next picker
            // starts from what the core pushes then.
            model.suggestions = nil
            guard let core = model.core else { return }
            Task { await model.attempt { try await core.closeRepositoryPicker() } }
        }
    }

    // MARK: Parts

    private var suggestions: ShownSuggestions { ShownSuggestions(model.suggestions) }

    private var rows: PickerRows { picker.rows(suggestions.repositories, login: login) }

    private var login: String? { model.setup.account?.login }

    private var canChange: Bool { SidebarActions(model: model).canChange }

    private var typedIsSuggested: Bool {
        guard let typed = picker.typedAddress else { return false }
        return suggestions.repositories.contains { $0.repository.sameRepository(as: typed) }
    }

    private func rowView(_ row: PickerRow) -> some View {
        PickerRowView(row: row) {
            withAnimation(.snappy) { picker.toggle(row) }
        }
    }

    /// What the picker says above its rows: what it is for, that
    /// suggestions are loading, that they could not all be read, that there
    /// are more than it lists, and the restrictions GitHub named.
    @ViewBuilder private var notes: some View {
        Section {
            switch suggestions.loading {
            case .loading:
                Label {
                    Text(
                        suggestions.repositories.isEmpty
                            ? "Loading suggestions…"
                            : "Loading suggestions… \(suggestions.repositories.count.formatted()) so far"
                    )
                    .contentTransition(.numericText())
                } icon: {
                    ProgressView().controlSize(.small)
                }
                .foregroundStyle(palette.muted)
            case .failed(let problem):
                PickerNote(
                    title: "Suggestions could not all be read", reason: ReasonText(problem, login: login),
                    systemImage: "exclamationmark.triangle.fill", warning: true
                ) {
                    guard let core = model.core else { return }
                    Task { await model.attempt { try await core.openRepositoryPicker() } }
                }
            case .loaded(let capped):
                if capped {
                    PickerNote(
                        title: nil,
                        reason: ReasonText(
                            text:
                                "Showing the \(suggestions.repositories.count.formatted()) most recently pushed repositories. Type owner/name for others."
                        ),
                        systemImage: "info.circle")
                }
            }
            if suggestions.incomplete && suggestions.restrictions.isEmpty {
                PickerNote(
                    title: nil,
                    reason: ReasonText(
                        text:
                            "GitHub left some repositories out of its answer without saying why. Type owner/name to add one."
                    ),
                    systemImage: "info.circle")
            }
            ForEach(suggestions.restrictions, id: \.self) { restriction in
                PickerNote(title: nil, reason: Self.restriction(restriction), systemImage: "lock")
            }
            if !canChange {
                PickerNote(
                    title: nil,
                    reason: ReasonText(text: "Repositories can’t be added while settings.json can’t be written."),
                    systemImage: "exclamationmark.triangle.fill", warning: true)
            }
        } header: {
            Text("Track repositories whose issues you can read. Their open issues come together in All; nothing on GitHub changes. Type owner/name or paste a link for any repository not suggested.")
                .textCase(nil)
                .font(.footnote)
                .foregroundStyle(palette.muted)
                .padding(.bottom, 4)
        }
    }

    private var suggestionsHeader: some View {
        HStack {
            Text(picker.owner.map { "\($0)’s Repositories" } ?? "Suggestions")
            Spacer()
            Text(rows.suggested.count.formatted())
                .monospacedDigit()
                .contentTransition(.numericText(value: Double(rows.suggested.count)))
        }
    }

    @ViewBuilder private var emptyState: some View {
        if rows.isEmpty, case .loaded = suggestions.loading {
            if picker.text.trimmingCharacters(in: .whitespaces).isEmpty {
                ContentUnavailableView(
                    "No Suggestions Found", systemImage: "book.closed",
                    description: Text(
                        "Suggestions list only repositories GitHub shows as yours or your organizations’. Type owner/name to add any other."
                    ))
            } else {
                ContentUnavailableView(
                    "No Matches", systemImage: "magnifyingglass",
                    description: Text("Type a repository as owner/name, or paste its link, to add one not suggested."))
            }
        }
    }

    private var footer: some View {
        let count = picker.selected.count
        return VStack(spacing: 8) {
            if let failure = picker.failure {
                Label(failure, systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(palette.destructive)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .transition(.blurReplace)
            }
            Button(action: add) {
                HStack(spacing: 8) {
                    if picker.busy == .adding { ProgressView().tint(.white) }
                    Text(addTitle(count))
                        .contentTransition(.numericText(value: Double(count)))
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .disabled(count == 0 || picker.busy != nil || !canChange)
            .keyboardShortcut(.defaultAction)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .animation(.snappy, value: count)
        .animation(.smooth, value: picker.failure)
    }

    private func addTitle(_ count: Int) -> String {
        if picker.busy == .adding { return "Adding…" }
        if count > 1 { return "Add \(count) Repositories" }
        return "Add Repository"
    }

    // MARK: Acting

    private func add() {
        guard let core = model.core, canChange, !picker.selected.isEmpty else { return }
        Task {
            let addedNow = await picker.add(with: core, login: login)
            guard !addedNow.isEmpty else { return }
            added += 1
            if picker.selected.isEmpty {
                model.post(Self.addedText(addedNow), systemImage: "checkmark.circle")
                dismiss()
            }
        }
    }

    private func skip() {
        guard let core = model.core else { return }
        Task {
            if await picker.skip(with: core) { dismiss() }
        }
    }

    /// "Added verdandi.", "Added verdandi and pacemark." or "Added 3 repositories."
    static func addedText(_ repositories: [PickerRepository]) -> String {
        let names = repositories.map(\.repository.name)
        switch names.count {
        case 1, 2: return "Added \(names.formatted(.list(type: .and)))."
        default: return "Added \(names.count) repositories."
        }
    }

    /// What a restriction GitHub named on the suggestions means.
    static func restriction(_ evidence: AccessEvidence) -> ReasonText {
        switch evidence {
        case .sso(let message, _):
            ReasonText(
                text:
                    "An organization’s repositories are left out until the token is authorized for its SAML single sign-on.",
                detail: message, link: ReasonText.ssoLink(evidence))
        case .organizationApproval(let message):
            ReasonText(
                text:
                    "An organization restricts OAuth App access and has not approved Verdandi, so its repositories are left out.",
                detail: message)
        }
    }
}

/// The suggestions as the core last pushed them, or nothing yet, loading,
/// before its first push.
private struct ShownSuggestions {
    var owners: [PickerOwner] = []
    var repositories: [PickerRepository] = []
    var loading: SuggestionsLoading = .loading
    var restrictions: [AccessEvidence] = []
    var incomplete = false

    init(_ suggestions: RepositorySuggestions?) {
        guard let suggestions else { return }
        owners = suggestions.owners
        repositories = suggestions.repositories
        loading = suggestions.loading
        restrictions = suggestions.restrictions
        incomplete = suggestions.incomplete
    }
}

/// What the typed address's check depends on: the address, and whether it
/// is suggested by that name.
private struct TypedKey: Hashable {
    var text: String
    var suggested: Bool
}

/// A note above the picker's rows, with what to do about it.
private struct PickerNote: View {
    @Environment(\.palette) private var palette
    var title: String?
    var reason: ReasonText
    var systemImage: String
    var warning = false
    var retry: (() -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: systemImage)
                .foregroundStyle(warning ? palette.warning : palette.muted)
            VStack(alignment: .leading, spacing: 3) {
                if let title {
                    Text(title).font(.subheadline.weight(.semibold))
                }
                Text(reason.text)
                    .font(.footnote)
                    .foregroundStyle(title == nil ? palette.foreground : palette.muted)
                if let detail = reason.detail {
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(palette.muted)
                }
                if let link = reason.link {
                    Link("Authorize on GitHub", destination: link)
                        .font(.footnote.weight(.semibold))
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if let retry {
                Button("Retry", action: retry)
                    .buttonStyle(.glass)
                    .controlSize(.small)
            }
        }
    }
}

/// The owners to show the suggestions of, as chips: every suggestion, the
/// account, then its organizations.
private struct OwnerFilter: View {
    @Environment(\.palette) private var palette
    var owners: [PickerOwner]
    @Binding var owner: String?

    var body: some View {
        ScrollView(.horizontal) {
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 8) {
                    chip(nil, title: "All")
                    ForEach(owners, id: \.login) { candidate in
                        chip(candidate.login, title: candidate.kind == .account ? "@\(candidate.login)" : candidate.login)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
            }
        }
        .scrollIndicators(.hidden)
    }

    private func chip(_ login: String?, title: String) -> some View {
        let isOn = owner?.lowercased() == login?.lowercased()
        return Button {
            withAnimation(.snappy) { owner = login }
        } label: {
            HStack(spacing: 6) {
                if let login {
                    SidebarAvatar(login: login, size: 20)
                }
                Text(title)
                    .font(.subheadline.weight(isOn ? .semibold : .regular))
                    .lineLimit(1)
            }
            .padding(.leading, login == nil ? 12 : 5)
            .padding(.trailing, 12)
            .padding(.vertical, 6)
            .foregroundStyle(isOn ? AnyShapeStyle(.white) : AnyShapeStyle(palette.foreground))
            .glassEffect(isOn ? .regular.tint(palette.accent).interactive() : .regular.interactive(), in: .capsule)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel(login == nil ? "All suggestions" : title)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

/// One repository: whether it is checked, its `owner/name`, and what keeps
/// it from being added, if anything.
private struct PickerRowView: View {
    @Environment(\.palette) private var palette
    var row: PickerRow
    var toggle: () -> Void

    var body: some View {
        if row.disabled {
            content
                .accessibilityElement(children: .combine)
        } else {
            Button(action: toggle) {
                content.contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(row.checked ? [.isButton, .isSelected] : .isButton)
            .accessibilityHint(row.checked ? "Leaves it out" : "Adds it with the others checked")
        }
    }

    private var content: some View {
        HStack(spacing: 12) {
            indicator
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(Text("\(row.repository.owner)/").foregroundStyle(palette.muted))\(Text(row.repository.name).fontWeight(.semibold))")
                    .foregroundStyle(row.disabled && !row.tracked ? palette.muted : palette.foreground)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if let note = row.note {
                    Text(note.text)
                        .font(.caption)
                        .foregroundStyle(row.failed ? palette.destructive : palette.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    if let detail = note.detail {
                        Text(detail)
                            .font(.caption)
                            .foregroundStyle(palette.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let link = note.link {
                        Link("Authorize on GitHub", destination: link)
                            .font(.caption.weight(.semibold))
                    }
                }
            }
            Spacer(minLength: 8)
            if row.archived {
                Label("Archived", systemImage: "archivebox")
                    .labelStyle(CompactLabelStyle())
                    .font(.caption)
                    .foregroundStyle(palette.muted)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(palette.muted.opacity(0.12), in: .capsule)
            }
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder private var indicator: some View {
        if row.checking {
            ProgressView()
        } else if row.tracked {
            Image(systemName: "checkmark.circle.fill")
                .font(.title3)
                .foregroundStyle(palette.muted)
                .accessibilityLabel("Tracked")
        } else if row.candidate == nil {
            Image(systemName: "exclamationmark.circle")
                .font(.title3)
                .foregroundStyle(palette.destructive)
        } else if row.disabled {
            Image(systemName: "nosign")
                .font(.title3)
                .foregroundStyle(palette.muted)
        } else {
            Image(systemName: row.checked ? "checkmark.circle.fill" : "circle")
                .font(.title3)
                .foregroundStyle(row.checked ? AnyShapeStyle(palette.accent) : AnyShapeStyle(.tertiary))
                .contentTransition(.symbolEffect(.replace))
                .accessibilityHidden(true)
        }
    }
}
