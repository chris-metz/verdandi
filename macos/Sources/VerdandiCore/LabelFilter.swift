import Foundation

/// The labels a list is narrowed to: its matches carry every one of them.
/// Labels are the same to a filter when named alike, whatever the case and
/// whichever repository each comes from, as GitHub's search treats them.
extension Array where Element == Label {
  /// Whether an issue with these labels carries every label of `filter`.
  public func carriesEvery(of filter: [Label]) -> Bool {
    filter.allSatisfy { wanted in contains { $0.name.lowercased() == wanted.name.lowercased() } }
  }

  /// Whether it has a label of this name.
  public func containsLabel(named name: String) -> Bool {
    contains { $0.name.lowercased() == name.lowercased() }
  }

  /// The filter with a label added, unless it has one of that name.
  public func adding(_ label: Label) -> [Label] {
    containsLabel(named: label.name) ? self : self + [label]
  }

  /// The filter without the label of a name.
  public func removing(named name: String) -> [Label] {
    filter { $0.name.lowercased() != name.lowercased() }
  }
}
