import Foundation

/// A gh executable that answered `gh --version`.
public struct GhExecutable: Sendable, Hashable {
  public var url: URL
  public var version: String
}

/// A gh that was found but cannot be used, and why.
public struct UnusableGh: Error, Sendable, Hashable {
  public var url: URL
  public var reason: String
}

public enum GhSearch: Sendable, Hashable {
  case found(GhExecutable)
  case notFound(unusable: [UnusableGh])
}

/// The oldest gh with everything Verdandi asks of it.
public let minimumGhVersion = [2, 81, 0]

/// Looks for gh where it was chosen, then on PATH, then where package
/// managers put it: an app opened from the Finder gets no shell PATH.
public func findGh(chosen: URL?) async -> GhSearch {
  var candidates: [URL] = []
  if let chosen { candidates.append(chosen) }
  let path = ProcessInfo.processInfo.environment["PATH"] ?? ""
  candidates += path.split(separator: ":").map { URL(fileURLWithPath: String($0)).appending(path: "gh") }
  let home = FileManager.default.homeDirectoryForCurrentUser
  candidates += [
    "/opt/homebrew/bin/gh",
    "/usr/local/bin/gh",
    "/opt/local/bin/gh",
    "/run/current-system/sw/bin/gh",
    "/nix/var/nix/profiles/default/bin/gh",
  ].map { URL(fileURLWithPath: $0) }
  candidates += [
    ".nix-profile/bin/gh",
    ".local/share/mise/shims/gh",
    ".local/bin/gh",
  ].map { home.appending(path: $0) }

  var seen = Set<String>()
  var unusable: [UnusableGh] = []
  for candidate in candidates where seen.insert(candidate.standardizedFileURL.path).inserted {
    guard FileManager.default.fileExists(atPath: candidate.path) else { continue }
    switch await probeGh(candidate) {
    case .success(let gh): return .found(gh)
    case .failure(let problem): unusable.append(problem)
    }
  }
  return .notFound(unusable: unusable)
}

/// Asks a gh for its version, and whether it is recent enough.
public func probeGh(_ url: URL) async -> Result<GhExecutable, UnusableGh> {
  switch await runCommand(url, ["--version"], timeout: .seconds(10)) {
  case .notFound:
    return .failure(UnusableGh(url: url, reason: "There is no gh there."))
  case .failedToStart(let message):
    return .failure(UnusableGh(url: url, reason: message))
  case .timedOut:
    return .failure(UnusableGh(url: url, reason: "gh did not answer in time."))
  case .exited(let code, let stdout, let stderr):
    let text = String(decoding: stdout, as: UTF8.self)
    guard code == 0, let match = text.firstMatch(of: /gh version (\d+)\.(\d+)\.(\d+)/) else {
      return .failure(UnusableGh(url: url, reason: stderr.isEmpty ? "It is not gh." : stderr))
    }
    let version = [Int(match.1)!, Int(match.2)!, Int(match.3)!]
    let versionText = version.map(String.init).joined(separator: ".")
    if version.lexicographicallyPrecedes(minimumGhVersion) {
      return .failure(
        UnusableGh(
          url: url,
          reason: "gh \(versionText) is too old: Verdandi needs \(minimumGhVersion.map(String.init).joined(separator: ".")) or later."
        ))
    }
    return .success(GhExecutable(url: url, version: versionText))
  }
}
