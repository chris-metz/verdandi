import SwiftUI
import VerdandiKit

/// The control beside the account that shows how much of GitHub's rate
/// limits is left, as the desktop's: a gauge whose needle drops with the
/// emptiest pool. Once a pool runs low or GitHub pauses it, it says so in
/// the warning colour and pulses. It opens a popover with every pool.
struct RateLimitsButton: View {
    @Environment(AppModel.self) private var model
    @Environment(\.palette) private var palette
    @State private var shown = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            let gauge = RateLimitGauge(budgets: model.budgets, states: model.rateLimits, now: context.date)
            Button {
                shown.toggle()
            } label: {
                Label {
                    Text(gauge.word ?? "Rate Limits")
                } icon: {
                    Image(systemName: gauge.symbol)
                        .contentTransition(.symbolEffect(.replace))
                }
                .labelStyle(GaugeLabelStyle(showsTitle: gauge.word != nil))
                .foregroundStyle(gauge.word == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(palette.warning))
                .symbolEffect(.pulse, isActive: gauge.word != nil)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(gauge.word == nil ? .circle : .capsule)
            .help(gauge.help)
            .accessibilityLabel("Rate Limits")
            .accessibilityValue(gauge.spoken)
            .animation(.smooth, value: gauge.word)
            .popover(isPresented: $shown, arrowEdge: .bottom) {
                RateLimitsPopover()
                    .environment(model)
                    .environment(\.palette, palette)
                    .presentationCompactAdaptation(.popover)
            }
        }
        .task {
            // A popover opens once its button is on screen.
            guard SidebarLaunchOptions.opensRateLimits else { return }
            try? await Task.sleep(for: .seconds(2))
            shown = true
        }
    }
}

/// The gauge alone while all is well, the gauge with its word once a pool
/// is low or paused.
private struct GaugeLabelStyle: LabelStyle {
    var showsTitle: Bool

    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 5) {
            configuration.icon
            if showsTitle {
                configuration.title
                    .font(.footnote.weight(.semibold))
                    .transition(.blurReplace)
            }
        }
    }
}

/// Every pool's budget: how much is left of how much, and when it refills,
/// with the pools that hold requests back named first.
struct RateLimitsPopover: View {
    @Environment(AppModel.self) private var model
    @Environment(\.palette) private var palette

    var body: some View {
        TimelineView(.periodic(from: .now, by: 15)) { context in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("GitHub Rate Limits")
                            .font(.headline)
                        Text(
                            model.setup.account.map { "What is left for @\($0.login), as GitHub last said." }
                                ?? "What is left, as GitHub last said."
                        )
                        .font(.footnote)
                        .foregroundStyle(palette.muted)
                    }
                    ForEach(RateLimitWords.holding(model.rateLimits, now: context.date), id: \.self) { line in
                        Label(line, systemImage: "pause.circle.fill")
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(palette.warning)
                    }
                    ForEach(RateLimitWords.pools, id: \.self) { pool in
                        PoolBudgetView(
                            pool: pool, budget: model.budgets.first { $0.pool == pool }, now: context.date)
                    }
                }
                .padding(20)
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(idealWidth: 340, maxWidth: 360)
        }
    }
}

/// One pool: its name, how much is left of how much in a bar, and when it
/// refills; or what it is spent on, until GitHub has said anything of it.
private struct PoolBudgetView: View {
    @Environment(\.palette) private var palette
    var pool: RateLimitPool
    var budget: RateLimitBudget?
    var now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: RateLimitWords.symbol(pool))
                    .foregroundStyle(palette.muted)
                    .frame(width: 20)
                    .accessibilityHidden(true)
                Text(RateLimitWords.title(pool))
                    .font(.subheadline.weight(.semibold))
                if let reading, reading.tone != .normal {
                    Text(reading.tone == .usedUp ? "Used Up" : "Low")
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .foregroundStyle(.white)
                        .background(reading.tone == .usedUp ? palette.destructive : palette.warning, in: .capsule)
                }
                Spacer(minLength: 8)
                if let reading {
                    Text(reading.left)
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(palette.muted)
                }
            }
            if let reading {
                Gauge(value: reading.share) { EmptyView() }
                    .gaugeStyle(.linearCapacity)
                    .tint(tint(reading.tone))
                    .accessibilityHidden(true)
                Text(reading.refill)
                    .font(.caption)
                    .foregroundStyle(palette.muted)
            } else {
                Text("Not used yet · \(RateLimitWords.purpose(pool))")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var reading: BudgetReading? {
        budget.map { BudgetReading($0, now: now) }
    }

    private func tint(_ tone: BudgetReading.Tone) -> Color {
        switch tone {
        case .normal: palette.accent
        case .low: palette.warning
        case .usedUp: palette.destructive
        }
    }
}

/// A pool's budget as it stands at a moment: all of it again once GitHub
/// has reset it, whatever GitHub last said.
struct BudgetReading {
    enum Tone { case normal, low, usedUp }

    var budget: RateLimitBudget
    var now: Date

    init(_ budget: RateLimitBudget, now: Date) {
        self.budget = budget
        self.now = now
    }

    var resetAt: Date { Date(timeIntervalSince1970: budget.resetAt / 1000) }
    var hasReset: Bool { resetAt <= now }

    /// The share left, from 0 to 1.
    var share: Double {
        if hasReset { return 1 }
        guard budget.limit > 0 else { return 0 }
        return min(max(Double(budget.remaining) / Double(budget.limit), 0), 1)
    }

    /// Less than a tenth left, as the core holds a pool low.
    var isLow: Bool { share < 0.1 }

    var tone: Tone {
        if budget.remaining == 0 && !hasReset { return .usedUp }
        return isLow ? .low : .normal
    }

    /// "4,620 of 5,000".
    var left: String {
        let remaining = hasReset ? budget.limit : budget.remaining
        return "\(remaining.formatted()) of \(budget.limit.formatted())"
    }

    /// "Refills in 38 minutes, at 14:40", or "Full again since 14:40".
    var refill: String {
        let at = RateLimitWords.time(resetAt, now: now)
        if hasReset { return "Full again since \(at)" }
        return "Refills in \(RateLimitWords.wait(resetAt.timeIntervalSince(now))), at \(at)"
    }
}

/// What the rate-limit control shows of every pool at a moment.
struct RateLimitGauge {
    var budgets: [RateLimitBudget]
    var states: [RateLimitState]
    var now: Date

    /// The emptiest pool's share left, once GitHub has said anything.
    var lowest: Double? {
        budgets.map { BudgetReading($0, now: now).share }.min()
    }

    /// Whether GitHub paused a pool's requests until it resets.
    var paused: Bool {
        states.contains { $0.status == .paused && $0.until / 1000 > now.timeIntervalSince1970 }
    }

    /// Whether a pool runs low, as the core or the budgets say.
    var low: Bool {
        states.contains { $0.status == .low && $0.until / 1000 > now.timeIntervalSince1970 }
            || budgets.contains { BudgetReading($0, now: now).isLow }
    }

    /// The word beside the gauge, while a pool holds requests back.
    var word: String? {
        if paused { return "Paused" }
        if low { return "Low" }
        return nil
    }

    /// A gauge whose needle stands about where the emptiest pool's share
    /// does, in five steps, and at two thirds before GitHub has said anything.
    var symbol: String {
        guard let lowest else { return "gauge.with.dots.needle.67percent" }
        if paused || lowest < 0.17 { return "gauge.with.dots.needle.0percent" }
        if lowest < 0.42 { return "gauge.with.dots.needle.33percent" }
        if lowest < 0.59 { return "gauge.with.dots.needle.50percent" }
        if lowest < 0.84 { return "gauge.with.dots.needle.67percent" }
        return "gauge.with.dots.needle.100percent"
    }

    var help: String {
        if paused { return "GitHub paused some of Verdandi’s requests" }
        return low ? "A GitHub rate limit is running low" : "GitHub rate limits"
    }

    var spoken: String {
        guard let lowest else { return "Not used yet" }
        let percent = "\(Int((lowest * 100).rounded())) percent left in the emptiest pool"
        return word.map { "\($0), \(percent)" } ?? percent
    }
}

/// How the rate limits are put in words, as the desktop puts them.
enum RateLimitWords {
    /// Every pool, in the order the popover lists them.
    static let pools: [RateLimitPool] = [.graphql, .core, .search]

    static func title(_ pool: RateLimitPool) -> String {
        switch pool {
        case .graphql: "GraphQL API"
        case .core: "REST API"
        case .search: "Search"
        }
    }

    static func symbol(_ pool: RateLimitPool) -> String {
        switch pool {
        case .graphql: "point.3.connected.trianglepath.dotted"
        case .core: "arrow.left.arrow.right"
        case .search: "magnifyingglass"
        }
    }

    /// What the pool is spent on, and how often it refills.
    static func purpose(_ pool: RateLimitPool) -> String {
        switch pool {
        case .graphql: "Lists, issue pages and the sidebar · refills hourly"
        case .core: "Other reads · refills hourly"
        case .search: "Views · refills every minute"
        }
    }

    /// What the pools that hold requests back do, e.g. "GitHub rate limit
    /// reached · requests paused until 14:37". REST search is named apart.
    static func holding(_ states: [RateLimitState], now: Date) -> [String] {
        var lines: [String] = []
        for state in states {
            let until = Date(timeIntervalSince1970: state.until / 1000)
            guard until > now else { continue }
            let limit = state.pool == .search ? "search limit" : "rate limit"
            let line =
                state.status == .paused
                ? "GitHub \(limit) reached · requests paused until \(time(until, now: now))"
                : "GitHub \(limit) low · automatic refresh off until \(time(until, now: now))"
            if !lines.contains(line) { lines.append(line) }
        }
        return lines
    }

    /// A time of day, with its day when it is not today.
    static func time(_ date: Date, now: Date) -> String {
        if Calendar.current.isDate(date, inSameDayAs: now) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        return date.formatted(.dateTime.month(.abbreviated).day().hour().minute())
    }

    /// A wait, e.g. "less than a minute", "38 minutes" or "1 hour, 5 minutes".
    static func wait(_ seconds: TimeInterval) -> String {
        if seconds < 60 { return "less than a minute" }
        let total = Int((seconds / 60).rounded())
        let hours = total / 60
        let minutes = total % 60
        var parts: [String] = []
        if hours > 0 { parts.append(hours == 1 ? "1 hour" : "\(hours) hours") }
        if minutes > 0 { parts.append(minutes == 1 ? "1 minute" : "\(minutes) minutes") }
        return parts.joined(separator: ", ")
    }
}
