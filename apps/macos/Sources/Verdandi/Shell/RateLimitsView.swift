import SwiftUI
import VerdandiCore

/// A rate-limit pool's budget as the window shows it.
struct PoolBudget: Equatable {
  var limit: Int
  var remaining: Int
  var resetAt: Date

  init(limit: Int, remaining: Int, resetAt: Date) {
    self.limit = limit
    self.remaining = remaining
    self.resetAt = resetAt
  }

  init(_ budget: RateLimitBudget) {
    self.init(limit: budget.limit, remaining: budget.remaining, resetAt: budget.resetAt)
  }

  /// Whether the pool has filled up again since GitHub last said.
  func hasReset(at now: Date) -> Bool { resetAt <= now }

  /// The share left, from 0 to 1: all of it once the pool has reset.
  func fraction(at now: Date) -> Double {
    if hasReset(at: now) { return 1 }
    return limit > 0 ? min(max(Double(remaining) / Double(limit), 0), 1) : 0
  }

  /// Less than a tenth left.
  func isLow(at now: Date) -> Bool { fraction(at: now) < 0.1 }
}

extension RateLimitPool {
  var title: String {
    switch self {
    case .graphql: "GraphQL API"
    case .core: "REST API"
    case .search: "Search"
    }
  }

  var symbol: String {
    switch self {
    case .graphql: "point.3.connected.trianglepath.dotted"
    case .core: "arrow.left.arrow.right"
    case .search: "magnifyingglass"
    }
  }

  /// What the pool is spent on, and how often it refills.
  var purpose: String {
    switch self {
    case .graphql: "Lists, issue pages and the sidebar · refills hourly"
    case .core: "Other reads · refills hourly"
    case .search: "Views · refills every minute"
    }
  }
}

/// The toolbar button that shows how much of GitHub's rate limits is left:
/// a gauge whose needle drops with the emptiest pool, orange and pulsing
/// once one runs low. It opens a popover with every pool.
struct RateLimitsButton: View {
  @Environment(AppModel.self) private var model
  @State private var isPresented = false

  var body: some View {
    let budgets = LaunchOptions.rateLimits ?? model.rateLimits.mapValues(PoolBudget.init)
    TimelineView(.periodic(from: .now, by: 30)) { context in
      let lowest = budgets.values.map { $0.fraction(at: context.date) }.min()
      let isLow = budgets.values.contains { $0.isLow(at: context.date) }
      Button {
        isPresented.toggle()
      } label: {
        Label("Rate Limits", systemImage: Self.symbol(for: lowest))
          .foregroundStyle(isLow ? AnyShapeStyle(.orange) : AnyShapeStyle(.primary))
          .symbolEffect(.pulse, isActive: isLow)
      }
      .help(isLow ? "A GitHub rate limit is running low" : "GitHub rate limits")
      .accessibilityValue(lowest.map { "\(Int(($0 * 100).rounded())) percent left in the emptiest pool" } ?? "Not used yet")
      .popover(isPresented: $isPresented, arrowEdge: .bottom) {
        RateLimitsPopover(budgets: budgets, login: model.login)
      }
    }
    .task {
      guard LaunchOptions.opensRateLimits else { return }
      try? await Task.sleep(for: .seconds(1))
      isPresented = true
    }
  }

  /// A gauge whose needle stands about where the fraction left does.
  static func symbol(for fraction: Double?) -> String {
    guard let fraction else { return "gauge.with.dots.needle.67percent" }
    return switch fraction {
    case ..<0.17: "gauge.with.dots.needle.0percent"
    case ..<0.42: "gauge.with.dots.needle.33percent"
    case ..<0.59: "gauge.with.dots.needle.50percent"
    case ..<0.84: "gauge.with.dots.needle.67percent"
    default: "gauge.with.dots.needle.100percent"
    }
  }
}

/// Every pool's budget: how much is left of how much, and when it refills.
struct RateLimitsPopover: View {
  var budgets: [RateLimitPool: PoolBudget]
  var login: String?

  var body: some View {
    TimelineView(.periodic(from: .now, by: 15)) { context in
      VStack(alignment: .leading, spacing: 16) {
        VStack(alignment: .leading, spacing: 2) {
          Text("GitHub Rate Limits").font(.headline)
          Text(login.map { "What is left for @\($0), as GitHub last said." } ?? "What is left, as GitHub last said.")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        ForEach(RateLimitPool.allCases, id: \.self) { pool in
          PoolRow(pool: pool, budget: budgets[pool], now: context.date)
        }
      }
      .padding(18)
      .frame(width: 320)
    }
    .background(WindowNumberReporter(role: "popover"))
  }
}

private struct PoolRow: View {
  var pool: RateLimitPool
  var budget: PoolBudget?
  var now: Date

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 8) {
        Image(systemName: pool.symbol)
          .foregroundStyle(.secondary)
          .frame(width: 18)
          .accessibilityHidden(true)
        Text(pool.title).fontWeight(.medium)
        if let budget, budget.isLow(at: now) {
          Text(budget.remaining == 0 ? "Used Up" : "Low")
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            .foregroundStyle(.white)
            .background(budget.remaining == 0 ? Color.red : Color.orange, in: .capsule)
        }
        Spacer()
        if let budget {
          Text(remainingText(budget))
            .font(.callout.monospacedDigit())
            .foregroundStyle(.secondary)
        }
      }
      if let budget {
        Gauge(value: budget.fraction(at: now)) { EmptyView() }
          .gaugeStyle(.linearCapacity)
          .tint(tint(budget))
          .accessibilityLabel(pool.title)
        Text(resetText(budget))
          .font(.caption)
          .foregroundStyle(.secondary)
      } else {
        Text("Not used yet · \(pool.purpose)")
          .font(.caption)
          .foregroundStyle(.tertiary)
      }
    }
    .accessibilityElement(children: .combine)
  }

  private func remainingText(_ budget: PoolBudget) -> String {
    let remaining = budget.hasReset(at: now) ? budget.limit : budget.remaining
    return "\(remaining.formatted()) of \(budget.limit.formatted())"
  }

  private func resetText(_ budget: PoolBudget) -> String {
    if budget.hasReset(at: now) {
      return "Full again since \(budget.resetAt.formatted(date: .omitted, time: .shortened))"
    }
    let wait = budget.resetAt.timeIntervalSince(now)
    let duration =
      wait < 60
      ? "less than a minute"
      : Duration.seconds(wait).formatted(
        .units(allowed: [.hours, .minutes], width: .wide, maximumUnitCount: 2).locale(.interface))
    return "Refills in \(duration), at \(budget.resetAt.formatted(date: .omitted, time: .shortened))"
  }

  private func tint(_ budget: PoolBudget) -> Color {
    if budget.remaining == 0 && !budget.hasReset(at: now) { return .red }
    return budget.isLow(at: now) ? .orange : .accentColor
  }
}

extension Locale {
  /// English, as Verdandi's words are, with the user's region: durations
  /// spelt out in a sentence then read as one language.
  static var interface: Locale {
    Locale(languageCode: .english, languageRegion: Locale.current.region)
  }
}
