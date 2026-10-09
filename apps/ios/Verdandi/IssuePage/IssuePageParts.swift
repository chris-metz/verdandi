import SwiftUI
import UIKit
import VerdandiKit

// The pieces the issue page's sections share: its column, its cards, its
// section titles, and how it says when things happened.

/// How the page is laid out.
enum IssuePageMetrics {
    /// The widest text reads well at, however wide the column on an iPad.
    static let readableWidth: CGFloat = 760
    /// The corners of the page's cards.
    static let cornerRadius: CGFloat = 18
}

extension View {
    /// Centres the view at a width text reads well at, within the page's
    /// margins.
    func issuePageColumn(margin: CGFloat) -> some View {
        frame(maxWidth: IssuePageMetrics.readableWidth, alignment: .leading)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, margin)
    }

    /// A solid card the page's content sits on: the theme's card colour,
    /// with a hairline edge, as GitHub draws its boxes, since a theme's card
    /// may be the colour of the page itself.
    func issuePageCard() -> some View {
        modifier(IssuePageCard())
    }
}

private struct IssuePageCard: ViewModifier {
    @Environment(\.palette) private var palette
    @Environment(\.displayScale) private var displayScale

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: IssuePageMetrics.cornerRadius, style: .continuous)
        content
            .background(palette.card, in: shape)
            .overlay(shape.strokeBorder(palette.border, lineWidth: 2 / displayScale))
            .clipShape(shape)
    }
}

/// A section of the page: its title, what it counts, an accessory at the
/// end, and its content below.
struct IssuePageSection<Content: View, Accessory: View>: View {
    @Environment(\.palette) private var palette
    var title: String
    var systemImage: String
    /// What the section counts, e.g. "3/5" or "12".
    var count: String?
    @ViewBuilder var accessory: Accessory
    @ViewBuilder var content: Content

    init(
        _ title: String, systemImage: String, count: String? = nil,
        @ViewBuilder accessory: () -> Accessory = { EmptyView() },
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.systemImage = systemImage
        self.count = count
        self.accessory = accessory()
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Label(title, systemImage: systemImage)
                        .font(.headline)
                        .foregroundStyle(palette.foreground)
                        .labelStyle(SectionLabelStyle())
                    if let count {
                        Text(count)
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(palette.muted)
                            .contentTransition(.numericText())
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                accessory
            }
            .padding(.horizontal, 4)
            content
        }
    }
}

/// A section title's icon in the page's quieter colour, before its text.
private struct SectionLabelStyle: LabelStyle {
    @Environment(\.palette) private var palette

    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 7) {
            configuration.icon
                .foregroundStyle(palette.muted)
                .symbolRenderingMode(.hierarchical)
            configuration.title
        }
    }
}

/// A part of the page that could not be read, or was read only in part,
/// said where it would show, with what can be done about it.
struct PartNotice<Actions: View>: View {
    @Environment(\.palette) private var palette
    var text: String
    var systemImage = "exclamationmark.triangle"
    @ViewBuilder var actions: Actions

    init(_ text: String, systemImage: String = "exclamationmark.triangle", @ViewBuilder actions: () -> Actions) {
        self.text = text
        self.systemImage = systemImage
        self.actions = actions()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label {
                Text(text)
                    .font(.subheadline)
                    .foregroundStyle(palette.foreground)
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: systemImage)
                    .foregroundStyle(palette.warning)
            }
            HStack(spacing: 8) { actions }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .padding(.leading, 30)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Grey lines where text will be, while it loads.
struct PlaceholderLines: View {
    var lines: Int
    var font: Font = .body

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(0..<lines, id: \.self) { line in
                Text(String(repeating: "Lorem ipsum dolor sit ", count: line == lines - 1 ? 2 : 6))
                    .font(font)
                    .lineLimit(1)
            }
        }
        .redacted(reason: .placeholder)
        .accessibilityHidden(true)
    }
}

/// A gentle pulse for what stands in for content while it loads.
struct LoadingPulse: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        if reduceMotion {
            content.opacity(0.7)
        } else {
            content.phaseAnimator([0.45, 0.85]) { view, opacity in
                view.opacity(opacity)
            } animation: { _ in .easeInOut(duration: 0.9) }
        }
    }
}

// MARK: - Dates

/// How the page says when something happened, in English as the rest of
/// the app, whatever the device's language: "3 days ago", as the desktop
/// app says it.
enum IssuePageDates {
    private static let relative: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateTimeStyle = .numeric
        formatter.unitsStyle = .full
        return formatter
    }()

    /// How long ago something happened on GitHub: just now within the first
    /// minute, then in whole minutes, hours, days, months or years.
    static func age(of date: Date, now: Date = .now) -> String {
        let seconds = max(0, now.timeIntervalSince(date))
        if seconds < 60 { return "just now" }
        let units: [(TimeInterval, Calendar.Component)] = [
            (31_536_000, .year), (2_592_000, .month), (86_400, .day), (3_600, .hour), (60, .minute),
        ]
        for (size, unit) in units where seconds >= size {
            var components = DateComponents()
            components.setValue(-Int(seconds / size), for: unit)
            return relative.localizedString(from: components)
        }
        return relative.localizedString(from: DateComponents(minute: -1))
    }

    /// The date in full, for VoiceOver and the context menus.
    static func full(_ date: Date) -> String {
        date.formatted(Date.FormatStyle(date: .long, time: .shortened, locale: Locale(identifier: "en_US")))
    }

    /// When data was read, by the clock: "14:02" today, with the date on
    /// another day, e.g. "Sep 26, 09:05".
    static func time(of date: Date, now: Date = .now) -> String {
        let clock = date.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).locale(Locale(identifier: "en_GB")))
        if Calendar.current.isDate(date, inSameDayAs: now) { return clock }
        let day = date.formatted(.dateTime.month(.abbreviated).day().locale(Locale(identifier: "en_US")))
        return "\(day), \(clock)"
    }

    /// How long ago data was read: "Updated just now" within the first
    /// minute, then in whole minutes, then whole hours.
    static func updated(_ date: Date, now: Date = .now) -> String {
        let minutes = Int(now.timeIntervalSince(date) / 60)
        if minutes < 1 { return "Updated just now" }
        if minutes < 60 { return "Updated \(minutes) min ago" }
        return "Updated \(minutes / 60) h ago"
    }
}

/// When something happened on GitHub, kept current as time passes.
struct AgeText: View {
    var date: Date

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            Text(IssuePageDates.age(of: date, now: context.date))
        }
        .accessibilityLabel(IssuePageDates.full(date))
    }
}

// MARK: - Links

/// What can be done with an issue's or a comment's page on GitHub.
@MainActor
enum GitHubLink {
    /// Puts a link on the pasteboard, as a URL so that it pastes as one.
    static func copy(_ url: URL) {
        UIPasteboard.general.url = url
    }

    /// Puts text on the pasteboard.
    static func copy(_ text: String) {
        UIPasteboard.general.string = text
    }
}

// MARK: - Moving from a page

extension AppModel {
    /// Adds a label to the label filter of the list the page was opened
    /// from, as clicking a label on the desktop app's page does, and says
    /// whether there is such a list.
    func addToLabelFilter(_ label: IssueLabel) async -> Bool {
        guard let core, let selection else { return false }
        await attempt { try await core.addLabelToFilter(selection.expandableList, label) }
        return true
    }

    /// Goes back to the list, leaving every page opened over it.
    func showList() {
        issuePath = []
        selectedIssue = nil
    }
}
