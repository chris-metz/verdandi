import SwiftUI
import VerdandiCore

/// The sheet that adds tracked repositories: the account's repositories and
/// its organizations', grouped by owner and loading page by page, filtered
/// by what is typed. An address typed in full that is not suggested is
/// looked up on GitHub. The search field keeps the keyboard: ↑ and ↓ move,
/// Space checks, Return adds, Escape cancels.
struct RepositoryPickerView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var picker = RepositoryPickerModel(text: SidebarLaunchOptions.pickerSearch)
  @FocusState private var searchFocused: Bool

  var body: some View {
    let sections = picker.sections(tracked: model.settings.repositories)
    let rows = sections.flatMap(\.rows)
    VStack(spacing: 0) {
      header
        .padding(.horizontal, 24)
        .padding(.top, 22)
      searchField(rows: rows)
        .padding(.horizontal, 20)
        .padding(.top, 16)
      if picker.owners.count > 1 {
        OwnerFilter(picker: picker)
          .padding(.top, 12)
      }
      Divider()
        .padding(.top, 12)
      RepositoryRows(picker: picker, sections: sections)
        .overlay { emptyState(sections: sections) }
      Divider()
      footer(rows: rows)
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }
    .frame(width: 560, height: 600)
    .task {
      searchFocused = true
      guard let client = model.client else { return }
      await picker.loadSuggestions(with: client)
    }
    .task(id: picker.typedAddress) {
      guard let client = model.client else { return }
      await picker.checkTypedAddress(with: client)
    }
    .onChange(of: picker.text) { picker.highlighted = nil }
  }

  // MARK: Parts

  private var header: some View {
    HStack(alignment: .top, spacing: 14) {
      Image(systemName: "book.closed.fill")
        .font(.title)
        .foregroundStyle(.tint)
        .frame(width: 44, height: 44)
        .background(.tint.opacity(0.14), in: .rect(cornerRadius: 11, style: .continuous))
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 3) {
        Text("Add Repositories")
          .font(.title2.weight(.semibold))
        Text("Their open issues come together in All. Nothing on GitHub changes.")
          .font(.callout)
          .foregroundStyle(.secondary)
      }
      Spacer(minLength: 0)
    }
  }

  private func searchField(rows: [PickerRow]) -> some View {
    HStack(spacing: 8) {
      Image(systemName: "magnifyingglass")
        .foregroundStyle(.secondary)
        .accessibilityHidden(true)
      TextField("Filter, or type owner/name", text: $picker.text)
        .textFieldStyle(.plain)
        .font(.title3)
        .focused($searchFocused)
        .onSubmit { add(rows: rows) }
        .onKeyPress(.downArrow) {
          picker.moveHighlight(by: 1, in: rows)
          return .handled
        }
        .onKeyPress(.upArrow) {
          picker.moveHighlight(by: -1, in: rows)
          return .handled
        }
        .onKeyPress(.space) {
          // Repository names have no spaces; Space checks the row instead.
          guard let row = rows.first(where: { $0.id == picker.highlighted }) else { return .ignored }
          withAnimation(.snappy) { picker.toggle(row) }
          return .handled
        }
      if !picker.text.isEmpty {
        Button("Clear", systemImage: "xmark.circle.fill") { picker.text = "" }
          .labelStyle(.iconOnly)
          .buttonStyle(.plain)
          .foregroundStyle(.secondary)
          .transition(.scale.combined(with: .opacity))
      }
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 10)
    .glassEffect(.regular.interactive(), in: .capsule)
    .animation(.smooth(duration: 0.2), value: picker.text.isEmpty)
  }

  @ViewBuilder
  private func emptyState(sections: [PickerSection]) -> some View {
    if sections.isEmpty {
      switch picker.loading {
      case .loading:
        ProgressView("Loading your repositories…")
          .controlSize(.small)
      case .failed(let error):
        ContentUnavailableView(
          "Could Not Load Suggestions", systemImage: "exclamationmark.triangle",
          description: Text("\(error.message)\nType a repository as owner/name to add it."))
      case .done, .capped:
        if picker.text.isEmpty {
          ContentUnavailableView(
            "No Repositories", systemImage: "book.closed",
            description: Text("Type a repository as owner/name to add it."))
        } else {
          ContentUnavailableView(
            "No Matches", systemImage: "magnifyingglass",
            description: Text("Type a repository as owner/name, or paste its URL, to add one not listed."))
        }
      }
    }
  }

  private func footer(rows: [PickerRow]) -> some View {
    let count = picker.selected.count
    return HStack(spacing: 10) {
      status
        .font(.callout)
        .foregroundStyle(.secondary)
        .contentTransition(.numericText())
      Spacer(minLength: 12)
      Button("Cancel", role: .cancel) { dismiss() }
        .buttonStyle(.glass)
        .keyboardShortcut(.cancelAction)
      Button {
        add(rows: rows)
      } label: {
        Text(count > 1 ? "Add \(count) Repositories" : "Add Repository")
          .contentTransition(.numericText(value: Double(count)))
          .frame(minWidth: 120)
      }
      .buttonStyle(.glassProminent)
      .keyboardShortcut(.defaultAction)
      .disabled(count == 0 || !model.sidebar.canChange)
      .animation(.snappy, value: count)
    }
    .controlSize(.large)
  }

  private var status: some View {
    HStack(spacing: 6) {
      switch picker.loading {
      case .loading:
        ProgressView().controlSize(.mini)
        Text("Loading… \(picker.suggestions.count.formatted()) so far")
      case .capped:
        Text("The first \(picker.suggestions.count.formatted()) repositories")
      case .done, .failed:
        if picker.selected.isEmpty {
          Text("\(picker.suggestions.count.formatted()) repositories")
        } else {
          Text("\(picker.selected.count.formatted()) selected")
        }
      }
    }
  }

  /// Adds the repositories checked, or the row the keyboard is on, and
  /// closes.
  private func add(rows: [PickerRow]) {
    let chosen = picker.chosen(in: rows)
    guard !chosen.isEmpty, model.sidebar.canChange else { return }
    model.sidebar.addRepositories(chosen)
    dismiss()
  }
}

/// The owners to show the suggestions of, as chips: all of them, the
/// account, then its organizations and other owners.
private struct OwnerFilter: View {
  @Bindable var picker: RepositoryPickerModel
  @Namespace private var glass

  var body: some View {
    ScrollView(.horizontal) {
      GlassEffectContainer(spacing: 2) {
        HStack(spacing: 8) {
          chip(nil, title: "All", avatar: nil)
          ForEach(picker.owners) { group in
            chip(group.owner, title: group.owner, avatar: group.owner)
          }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 2)
      }
    }
    .scrollIndicators(.never)
  }

  private func chip(_ owner: String?, title: String, avatar: String?) -> some View {
    let isOn = picker.ownerFilter?.lowercased() == owner?.lowercased()
    return Button {
      withAnimation(.snappy) {
        picker.ownerFilter = owner
        picker.highlighted = nil
      }
    } label: {
      HStack(spacing: 5) {
        if let avatar { OwnerAvatar(owner: avatar, size: 16) }
        Text(title)
          .font(.callout.weight(isOn ? .semibold : .regular))
          .lineLimit(1)
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 5)
      .foregroundStyle(isOn ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
      .glassEffect(isOn ? .regular.tint(.accentColor).interactive() : .regular.interactive(), in: .capsule)
      .glassEffectID(owner ?? "", in: glass)
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(isOn ? .isSelected : [])
  }
}

/// The picker's rows, grouped, with the keyboard's row kept in sight.
private struct RepositoryRows: View {
  @Bindable var picker: RepositoryPickerModel
  var sections: [PickerSection]

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 2) {
          ForEach(sections) { section in
            SectionTitle(section: section)
              .padding(.top, section.id == sections.first?.id ? 4 : 14)
              .padding(.bottom, 4)
            ForEach(section.rows) { row in
              PickerRowView(row: row, isHighlighted: picker.highlighted == row.id)
                .id(row.id)
                .onTapGesture {
                  picker.highlighted = row.id
                  withAnimation(.snappy) { picker.toggle(row) }
                }
            }
          }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
      }
      .onChange(of: picker.highlighted) { _, id in
        guard let id else { return }
        withAnimation(.snappy) { proxy.scrollTo(id) }
      }
    }
  }
}

/// A section's title: what was typed, or an owner with its avatar.
private struct SectionTitle: View {
  var section: PickerSection

  var body: some View {
    HStack(spacing: 7) {
      switch section.kind {
      case .typed:
        Image(systemName: "keyboard")
          .foregroundStyle(.secondary)
          .frame(width: 18)
        Text("Typed Address")
      case .owner(let kind):
        OwnerAvatar(owner: section.title, size: 18)
        Text(section.title)
        Text(kind == .account ? "You" : kind == .organization ? "Organization" : "Collaborator")
          .font(.caption)
          .foregroundStyle(.tertiary)
      }
      Spacer()
      if case .owner = section.kind {
        Text(section.rows.count.formatted())
          .font(.caption)
          .monospacedDigit()
          .foregroundStyle(.tertiary)
      }
    }
    .font(.subheadline.weight(.semibold))
    .foregroundStyle(.secondary)
    .padding(.horizontal, 10)
    .accessibilityAddTraits(.isHeader)
  }
}

/// One repository: a checkbox, its name, and what keeps it from being
/// added, if anything.
private struct PickerRowView: View {
  var row: PickerRow
  var isHighlighted: Bool

  var body: some View {
    HStack(spacing: 10) {
      checkbox
      VStack(alignment: .leading, spacing: 1) {
        Text(row.isTyped ? row.address.description : row.address.name)
          .fontWeight(.medium)
          .foregroundStyle(row.canToggle || row.status == .tracked ? .primary : .secondary)
          .lineLimit(1)
        if let note {
          Text(note)
            .font(.caption)
            .foregroundStyle(noteStyle)
            .lineLimit(2)
        }
      }
      Spacer(minLength: 8)
      if row.isArchived {
        Label("Archived", systemImage: "archivebox")
          .font(.caption)
          .foregroundStyle(.secondary)
          .padding(.horizontal, 7)
          .padding(.vertical, 2)
          .background(.fill.tertiary, in: .capsule)
          .help("Archived on GitHub: its issues can be read, not changed.")
      }
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 7)
    .background(background, in: .rect(cornerRadius: 9, style: .continuous))
    .contentShape(.rect)
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(row.isChecked ? [.isButton, .isSelected] : .isButton)
    .accessibilityHint(row.canToggle ? "Toggles whether it is added" : "")
  }

  @ViewBuilder
  private var checkbox: some View {
    switch row.status {
    case .checking:
      ProgressView()
        .controlSize(.small)
        .frame(width: 20, height: 20)
    case .notFound:
      Image(systemName: "questionmark.circle")
        .font(.title3)
        .foregroundStyle(.secondary)
        .frame(width: 20, height: 20)
    case .unavailable:
      Image(systemName: "nosign")
        .font(.title3)
        .foregroundStyle(.tertiary)
        .frame(width: 20, height: 20)
    case .available, .tracked:
      Image(systemName: row.isChecked ? "checkmark.circle.fill" : "circle")
        .font(.title3)
        .foregroundStyle(checkStyle)
        .contentTransition(.symbolEffect(.replace))
        .frame(width: 20, height: 20)
    }
  }

  private var checkStyle: AnyShapeStyle {
    guard row.isChecked else { return AnyShapeStyle(.tertiary) }
    return row.status == .tracked ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tint)
  }

  private var note: String? {
    switch row.status {
    case .available:
      // GitHub followed a rename or transfer of the address typed.
      if row.isTyped, let typed = row.typedAddress, typed != row.address { "Moved here from \(typed)" } else { nil }
    case .tracked: "Tracked already"
    case .unavailable(let reason): reason
    case .checking: "Looking it up on GitHub…"
    case .notFound(let message): message
    }
  }

  private var noteStyle: AnyShapeStyle {
    if case .notFound = row.status { return AnyShapeStyle(.red) }
    return AnyShapeStyle(.secondary)
  }

  private var background: AnyShapeStyle {
    if isHighlighted { return AnyShapeStyle(.tint.opacity(0.16)) }
    if row.isChecked && row.status == .available { return AnyShapeStyle(.tint.opacity(0.07)) }
    return AnyShapeStyle(.clear)
  }
}

/// An owner's avatar from GitHub, round.
struct OwnerAvatar: View {
  var owner: String
  var size: CGFloat

  var body: some View {
    AvatarView(
      actor: Actor(login: owner, avatarURL: URL(string: "https://github.com/\(owner).png?size=\(Int(size * 2))")),
      size: size)
  }
}
