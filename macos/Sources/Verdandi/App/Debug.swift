import AppKit
import SwiftUI
import VerdandiCore

/// Launch options read from the environment, for screenshots and for
/// trying a state without clicking to it:
///
/// - `VERDANDI_APPEARANCE`: `light` or `dark`, over the one chosen in
///   Settings, without changing it
/// - `VERDANDI_SELECT`: `all`, `repo:owner/name` or `view:<id>`
/// - `VERDANDI_ISSUE`: `owner/name#12`, the issue whose page opens over the list
/// - `VERDANDI_BODY`: an HTML file that issue pages show as the body, in
///   place of the one GitHub rendered
/// - `VERDANDI_LOAD_IMAGES=1`: loads each image from elsewhere than GitHub
///   as its placeholder shows, as if it was clicked
/// - `VERDANDI_SHEET`: `repository-picker`, `new-view` or `go-to-issue`
/// - `VERDANDI_GO_TO`: what is typed in Go to Issue as it opens; with
///   `VERDANDI_GO_TO_SUBMIT=1`, as if Return was pressed
/// - `VERDANDI_SETUP`: `checking`, `gh-missing`, `signed-out`, `rejected`
///   or `failed`: shows that setup state without asking gh, and without
///   changing gh's state
/// - `VERDANDI_SETTINGS`: `general` or `github`, opens Settings on that tab
/// - `VERDANDI_ABOUT=1`: opens the About window
/// - `VERDANDI_POPOVER=rate-limits`: opens the rate-limit popover
/// - `VERDANDI_RATE_LIMITS`: `sample` or `low`, made-up budgets instead of
///   GitHub's
/// - `VERDANDI_NOTICES=sample`: a few notices, one of them repeated
/// - `VERDANDI_WINDOW_SIZE`: e.g. `1440x900`
/// - `VERDANDI_WINDOW_FILE`: where to write the window's number, and its
///   frame in screen points from the top left, once it shows, for
///   `screencapture`
/// - `VERDANDI_SNAP`: `main`, `settings`, `about` or `popover`, the window
///   whose number goes to `VERDANDI_WINDOW_FILE`; by default the one asked
///   to open, else the main window
/// - `VERDANDI_ACTIVATE=1`: bring the window to the front, so it shows as
///   the active window does
/// - `VERDANDI_MENU`: a menu item to choose once the window shows, e.g.
///   `View/Show Closed`
/// - `VERDANDI_MENU_FILE`: where to write the menu bar, an item a line with
///   its shortcut and whether it is enabled, once the window shows and
///   again after `VERDANDI_MENU`
enum LaunchOptions {
  static let environment = ProcessInfo.processInfo.environment

  static var appearance: NSAppearance? {
    switch environment["VERDANDI_APPEARANCE"] {
    case "light": NSAppearance(named: .aqua)
    case "dark": NSAppearance(named: .darkAqua)
    default: nil
    }
  }

  static var selection: SidebarItem? {
    guard let value = environment["VERDANDI_SELECT"] else { return nil }
    if value == "all" { return .all }
    if value.hasPrefix("repo:"), let address = RepositoryAddress(String(value.dropFirst(5))) {
      return .repository(address)
    }
    if value.hasPrefix("view:") { return .view(id: String(value.dropFirst(5))) }
    return nil
  }

  /// The issue to show, as `owner/name` and number.
  static var issue: (RepositoryAddress, Int)? {
    guard let value = environment["VERDANDI_ISSUE"],
      let locator = IssueLocator(parsing: value), let address = locator.repository
    else { return nil }
    return (address, locator.number)
  }

  /// The body HTML that `VERDANDI_BODY` names, if it can be read.
  static let bodyHTML: String? = environment["VERDANDI_BODY"].flatMap {
    try? String(contentsOfFile: $0, encoding: .utf8)
  }

  static var loadsImages: Bool { environment["VERDANDI_LOAD_IMAGES"] == "1" }

  static var sheet: AppSheet? {
    switch environment["VERDANDI_SHEET"] {
    case "repository-picker": .repositoryPicker
    case "new-view": .viewEditor(nil)
    case "go-to-issue": .goToIssue
    default: nil
    }
  }

  static var goToText: String? { environment["VERDANDI_GO_TO"] }

  /// Whether Go to Issue goes to what `VERDANDI_GO_TO` typed at once.
  static var submitsGoTo: Bool { environment["VERDANDI_GO_TO_SUBMIT"] == "1" }

  /// Whether a setup state is shown instead of asking gh.
  static var pretendsSetup: Bool { environment["VERDANDI_SETUP"] != nil }

  /// The Settings tab to open at launch, if any.
  static var settingsTab: SettingsTab? {
    environment["VERDANDI_SETTINGS"].map { SettingsTab(rawValue: $0) ?? .general }
  }

  static var opensAbout: Bool { environment["VERDANDI_ABOUT"] == "1" }

  static var opensRateLimits: Bool { environment["VERDANDI_POPOVER"] == "rate-limits" }

  /// Which window `VERDANDI_WINDOW_FILE` names.
  static var snappedWindow: String {
    environment["VERDANDI_SNAP"]
      ?? (settingsTab != nil ? "settings" : opensAbout ? "about" : opensRateLimits ? "popover" : "main")
  }

  /// Made-up budgets for `VERDANDI_RATE_LIMITS`.
  static var rateLimits: [RateLimitPool: PoolBudget]? {
    let low = environment["VERDANDI_RATE_LIMITS"] == "low"
    guard low || environment["VERDANDI_RATE_LIMITS"] == "sample" else { return nil }
    return [
      .graphql: PoolBudget(limit: 5000, remaining: low ? 312 : 4620, resetAt: .now + 38 * 60),
      .core: PoolBudget(limit: 5000, remaining: 4987, resetAt: .now + 52 * 60),
      .search: PoolBudget(limit: 30, remaining: low ? 2 : 27, resetAt: .now + 41),
    ]
  }

  static var windowSize: CGSize? {
    guard let value = environment["VERDANDI_WINDOW_SIZE"],
      let match = value.firstMatch(of: /^(\d+)x(\d+)$/),
      let width = Int(match.1), let height = Int(match.2)
    else { return nil }
    return CGSize(width: width, height: height)
  }

  static var windowFile: URL? {
    environment["VERDANDI_WINDOW_FILE"].map(URL.init(fileURLWithPath:))
  }

  /// Applies the options that need the model as the window first shows:
  /// a pretended setup state, or else the check of the real one.
  static func start(_ model: AppModel) async {
    if environment["VERDANDI_NOTICES"] == "sample" { reportSamples(to: model) }
    guard let value = environment["VERDANDI_SETUP"] else {
      await model.checkSetup()
      return
    }
    switch value {
    case "gh-missing":
      // Real answers of files that are not a usable gh.
      var unusable: [UnusableGh] = []
      for path in ["/usr/local/bin/gh", "/usr/bin/true"] {
        if case .failure(let problem) = await probeGh(URL(fileURLWithPath: path)) { unusable.append(problem) }
      }
      model.pretendSetup(.ghMissing(unusable: unusable))
    case "signed-out": model.pretendSetup(.signedOut)
    case "rejected":
      model.pretendSetup(.rejected(login: "octocat", message: "The token in keyring is invalid."))
    case "failed":
      model.pretendSetup(
        .failed("error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com"))
    default: model.pretendSetup(.checking)
    }
  }

  /// Chooses the menu item `VERDANDI_MENU` names and writes the menu bar
  /// to `VERDANDI_MENU_FILE`, a few seconds after the window shows, which
  /// tests the commands without clicking.
  static func exerciseMenus() async {
    guard environment["VERDANDI_MENU"] != nil || environment["VERDANDI_MENU_FILE"] != nil else { return }
    try? await Task.sleep(for: .seconds(4))
    var lines = describe(NSApp.mainMenu, depth: 0)
    if let path = environment["VERDANDI_MENU"]?.split(separator: "/").map(String.init), path.count == 2,
      let menu = NSApp.mainMenu?.item(withTitle: path[0])?.submenu
    {
      menu.delegate?.menuNeedsUpdate?(menu)
      menu.update()
      let index = menu.indexOfItem(withTitle: path[1])
      lines.append(index >= 0 ? "chose \(path.joined(separator: "/"))" : "no item \(path.joined(separator: "/"))")
      if index >= 0 { menu.performActionForItem(at: index) }
      try? await Task.sleep(for: .seconds(2))
      lines += describe(NSApp.mainMenu, depth: 0)
    }
    if let file = environment["VERDANDI_MENU_FILE"] {
      try? lines.joined(separator: "\n").write(toFile: file, atomically: true, encoding: .utf8)
    }
  }

  private static func describe(_ menu: NSMenu?, depth: Int) -> [String] {
    guard let menu else { return [] }
    // As when the menu opens: SwiftUI brings its items up to date then.
    menu.delegate?.menuNeedsUpdate?(menu)
    menu.update()
    return menu.items.flatMap { item -> [String] in
      guard !item.isSeparatorItem else { return [] }
      let key = item.keyEquivalent.isEmpty ? "" : " [\(item.keyEquivalentModifierMask.contains(.shift) ? "⇧" : "")⌘\(item.keyEquivalent)]"
      let state = item.state == .on ? " ✓" : ""
      let line = String(repeating: "  ", count: depth) + item.title + key + state + (item.isEnabled ? "" : " (disabled)")
      return [line] + (depth == 0 ? describe(item.submenu, depth: depth + 1) : [])
    }
  }

  /// Applies the options that need the model, once gh works.
  static func apply(to model: AppModel) async {
    if let selection { model.selection = selection }
    if let sheet { model.sheet = sheet }
    if let (address, number) = issue, let client = model.client,
      case .issue(let reference, _) = try? await client.item(numbered: number, in: address)
    {
      model.openIssue(reference.id)
    }
  }

  private static func reportSamples(to model: AppModel) {
    model.report(
      "Could Not Load cli/cli",
      "Could not resolve to a Repository with the name 'cli/cli-old'.")
    for _ in 0..<3 {
      model.report("Rate Limited", GitHubError.rateLimited("API rate limit exceeded for user.", retryAfter: 60))
    }
    model.report("Went to a Pull Request", "cli/cli#9000 is a pull request: it opened on GitHub.", kind: .info)
  }
}

/// Writes the window's number and frame to `VERDANDI_WINDOW_FILE` once it
/// shows, and as it moves or resizes, when it is the window
/// `VERDANDI_SNAP` names; the main window also sizes itself as
/// `VERDANDI_WINDOW_SIZE` says.
struct WindowNumberReporter: NSViewRepresentable {
  /// `main`, `settings`, `about` or `popover`.
  var role = "main"

  func makeNSView(context: Context) -> NSView { ReportingView(role: role) }
  func updateNSView(_ view: NSView, context: Context) {}

  final class ReportingView: NSView {
    let role: String
    private var observers: [NSObjectProtocol] = []

    init(role: String) {
      self.role = role
      super.init(frame: .zero)
    }

    required init?(coder: NSCoder) { nil }

    override func viewDidMoveToWindow() {
      super.viewDidMoveToWindow()
      observers.forEach(NotificationCenter.default.removeObserver)
      observers = []
      guard let window else { return }
      if role == "main", let size = LaunchOptions.windowSize {
        // After SwiftUI has restored the frame it saved.
        DispatchQueue.main.async {
          window.setContentSize(size)
          window.center()
        }
      }
      guard role == LaunchOptions.snappedWindow else { return }
      if LaunchOptions.environment["VERDANDI_ACTIVATE"] == "1" {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
          NSApp.activate(ignoringOtherApps: true)
          window.makeKeyAndOrderFront(nil)
          window.orderFrontRegardless()
        }
      }
      guard LaunchOptions.windowFile != nil else { return }
      writeFrame()
      for name in [NSWindow.didResizeNotification, NSWindow.didMoveNotification] {
        observers.append(
          NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.writeFrame() }
          })
      }
    }

    /// Writes "number x y width height", counting from the top left of the
    /// main screen, as screencapture -R does.
    private func writeFrame() {
      guard let window, let file = LaunchOptions.windowFile, let screen = NSScreen.screens.first else { return }
      let frame = window.frame
      let line = [window.windowNumber, Int(frame.minX), Int(screen.frame.maxY - frame.maxY), Int(frame.width), Int(frame.height)]
        .map(String.init).joined(separator: " ")
      try? (line + "\n").write(to: file, atomically: true, encoding: .utf8)
    }
  }
}
