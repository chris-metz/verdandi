import AppKit
import SwiftUI
import VerdandiCore

/// Launch options for the list the window opens with, besides those of
/// `LaunchOptions`, for screenshots and for trying a state without clicking
/// to it:
///
/// - `VERDANDI_LIST_STATE`: `closed`, to open All or a repository's list
///   on its closed issues
/// - `VERDANDI_LABEL_FILTER`: label names separated by commas, the label
///   filter to start with, coloured as the list's issues colour them
/// - `VERDANDI_LIST_SELECT`: `first`, `#12` or a node ID, the row to select
///   once the list has loaded
/// - `VERDANDI_LIST_KEYS`: keys to press in the window once the list has
///   loaded, separated by spaces, e.g. `j j left e esc`, to try the keyboard
///   where no other app may type into this one. `delete` is ⌫, `wait` waits
///   a second, and `click@x,y` clicks at a point of the window, from its top
///   left corner.
enum ListLaunchOptions {
  /// Whether they have been applied, which they are once.
  private static var applied = false

  /// Whether the options are for this list: the one the window opens with.
  static func areFor(_ list: IssueListModel) -> Bool {
    LaunchOptions.selection == list.item
  }

  /// Applies what waits for the list to load: its label filter, the row to
  /// select, which scrolls to the top, and the keys to press.
  static func applyOnceLoaded(to list: IssueListModel, model: AppModel, scroller: ScrollViewProxy) async {
    guard areFor(list), !applied else { return }
    applied = true
    list.applyLaunchLabels()
    if model.selectedIssueID == nil, let id = selectedID(in: list.forest) {
      model.selectedIssueID = id
      try? await Task.sleep(for: .milliseconds(300))
      scroller.scrollTo(id, anchor: .top)
    }
    await pressKeys()
  }

  static var state: IssueState? {
    LaunchOptions.environment["VERDANDI_LIST_STATE"].flatMap(IssueState.init(rawValue:))
  }

  static var labelNames: [String] {
    (LaunchOptions.environment["VERDANDI_LABEL_FILTER"] ?? "")
      .split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
  }

  /// The issue `VERDANDI_LIST_SELECT` names in a forest.
  static func selectedID(in forest: Forest) -> String? {
    guard let value = LaunchOptions.environment["VERDANDI_LIST_SELECT"] else { return nil }
    if value == "first" { return forest.trees.first?.id }
    if value.hasPrefix("#"), let number = Int(value.dropFirst()) {
      return forest.allNodes.first { $0.reference.number == number }?.id
    }
    return value
  }
}

extension ListLaunchOptions {
  /// Presses `VERDANDI_LIST_KEYS` in the window, as the keyboard would.
  static func pressKeys() async {
    guard let keys = LaunchOptions.environment["VERDANDI_LIST_KEYS"] else { return }
    let named: [String: (String, UInt16)] = [
      "left": ("\u{F702}", 123), "right": ("\u{F703}", 124), "down": ("\u{F701}", 125),
      "up": ("\u{F700}", 126), "esc": ("\u{1B}", 53), "return": ("\r", 36), "delete": ("\u{7F}", 51),
    ]
    let letters: [Character: UInt16] = ["j": 38, "k": 40, "e": 14, "r": 15, "s": 1, "o": 31, "[": 33]
    for key in keys.split(separator: " ").map(String.init) {
      try? await Task.sleep(for: .milliseconds(500))
      if key == "wait" {
        try? await Task.sleep(for: .seconds(1))
        continue
      }
      if key.hasPrefix("click@") {
        click(at: key.dropFirst(6))
        continue
      }
      guard let (characters, code) = named[key] ?? key.first.flatMap({ letters[$0] }).map({ (key, $0) }),
        let window = NSApp.keyWindow ?? NSApp.windows.first(where: \.isVisible)
      else { continue }
      for type in [NSEvent.EventType.keyDown, .keyUp] {
        guard
          let event = NSEvent.keyEvent(
            with: type, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: window.windowNumber, context: nil, characters: characters,
            charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code)
        else { continue }
        window.sendEvent(event)
      }
    }
  }
}

/// Clicks at `x,y`, in points from the window's top left corner.
@MainActor
private func click(at point: Substring) {
  let parts = point.split(separator: ",").compactMap { Double($0) }
  guard parts.count == 2, let window = NSApp.keyWindow ?? NSApp.windows.first(where: \.isVisible) else { return }
  let location = NSPoint(x: parts[0], y: window.frame.height - parts[1])
  for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
    guard
      let event = NSEvent.mouseEvent(
        with: type, location: location, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
        windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)
    else { continue }
    // Queued, not sent: a list tracks the mouse from its press until it is
    // released, reading the release from the queue.
    NSApp.postEvent(event, atStart: false)
  }
}

extension IssueListModel {
  /// Starts in the state the launch options say, if they are for it.
  func applyLaunchState() {
    guard ListLaunchOptions.areFor(self), let state = ListLaunchOptions.state else { return }
    setState(state)
  }

  /// Narrows to the labels the launch options name, once loaded, in the
  /// colours of the issues that carry them.
  func applyLaunchLabels() {
    guard ListLaunchOptions.areFor(self), labelFilter.isEmpty else { return }
    let known = labelCounts.map(\.label)
    for name in ListLaunchOptions.labelNames {
      addLabel(known.first { $0.name.lowercased() == name.lowercased() } ?? Label(name: name, color: "888888"))
    }
  }
}
