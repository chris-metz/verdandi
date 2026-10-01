import Foundation
import SwiftUI

/// A command to copy and run in Terminal.
struct GuidanceCommand: Hashable {
  var label: String
  var command: String
}

/// What the setup screen says about a setup state, and what it offers.
/// Verdandi never installs gh or signs in itself: the user does, in
/// Terminal, then checks again, or Verdandi does as it becomes active again.
struct SetupGuidance {
  var title: String
  var symbol: String
  var tint: Color
  /// What is wrong and what to do, a paragraph each.
  var explanation: [String]
  var commands: [GuidanceCommand] = []
  /// gh's or GitHub's own words, if any.
  var detail: String?
  /// Whether choosing gh is the action offered first, rather than checking
  /// again.
  var choosesGh = false
  /// A page with more help.
  var link: (title: String, url: URL)?

  static let signIn = GuidanceCommand(label: "Sign in", command: "gh auth login --hostname github.com")

  /// The guidance for a state that is not ready, or `nil` for one that is,
  /// or is being checked.
  init?(_ state: SetupState) {
    switch state {
    case .checking, .ready:
      return nil
    case .ghMissing:
      title = "GitHub CLI Not Found"
      symbol = "terminal"
      tint = .orange
      explanation = [
        "Verdandi reads GitHub through GitHub CLI (gh), and could not find one it can use. Install it and sign in, in Terminal: Verdandi picks it up as soon as you come back."
      ]
      commands = [GuidanceCommand(label: "Install with Homebrew", command: "brew install gh"), Self.signIn]
      choosesGh = true
      link = Self.link("Other Ways to Install", "https://github.com/cli/cli#installation")
    case .signedOut:
      title = "Sign In to GitHub"
      symbol = "person.crop.circle.badge.questionmark"
      tint = .accentColor
      explanation = [
        "GitHub CLI is installed but not signed in to github.com. Sign in in Terminal — Verdandi never signs in itself — and it picks that up as soon as you come back."
      ]
      commands = [Self.signIn]
    case .rejected(let login, let message):
      symbol = "person.crop.circle.badge.exclamationmark"
      tint = .orange
      detail = message
      if let variable = Self.tokenVariable {
        title = "GitHub Rejected \(variable)"
        explanation = [
          "Verdandi was started with \(variable) set, so gh reads github.com with that token instead of the account it has stored, and GitHub rejected it.",
          "Signing in again in gh does not change this. Change or remove \(variable) where Verdandi is started, then restart Verdandi.",
        ]
      } else {
        title = "GitHub Rejected gh’s Sign-In"
        let account = login.map { " for @\($0)" } ?? ""
        explanation = [
          "GitHub no longer accepts gh’s credentials\(account), e.g. because the token expired or was revoked. Refresh them, or sign in again, in Terminal."
        ]
        commands = [
          GuidanceCommand(label: "Refresh the credentials", command: "gh auth refresh --hostname github.com"),
          GuidanceCommand(label: "Or sign in again", command: Self.signIn.command),
        ]
      }
    case .failed(let message):
      title = "Can’t Reach GitHub"
      symbol = "wifi.exclamationmark"
      tint = .orange
      explanation = [
        "GitHub CLI could not tell whether it is signed in. Check your internet connection, then check again."
      ]
      detail = message
      link = Self.link("GitHub Status", "https://www.githubstatus.com")
    }
  }

  private static func link(_ title: String, _ address: String) -> (title: String, url: URL)? {
    URL(string: address).map { (title, $0) }
  }

  /// The environment variable gh reads a token from instead of its own
  /// sign-in, if Verdandi was started with one.
  static var tokenVariable: String? {
    let environment = ProcessInfo.processInfo.environment
    return ["GH_TOKEN", "GITHUB_TOKEN"].first { environment[$0]?.isEmpty == false }
  }
}
