import Foundation
import Observation
import VerdandiCore

/// The images bodies show from elsewhere than GitHub's media hosts, each
/// loaded once the user asked, by its address (ADR 0003). One loaded stays
/// so for the session, so that asking for it again, in another body or when
/// a page shows again, reads nothing again.
@Observable
final class ThirdPartyImages {
  enum State: Equatable {
    case loading
    /// A `data:` URL that shows it, which the bodies' policy lets load.
    case loaded(String)
    /// Why it could not be loaded, in a few words.
    case failed(String)
  }

  private(set) var states: [URL: State] = [:]
  @ObservationIgnored private let loader: @Sendable (URL) async -> LoadedImage

  init(load: @escaping @Sendable (URL) async -> LoadedImage = ImageLoader().load) {
    self.loader = load
  }

  /// Loads the image at `url`, unless it is loaded or loading already.
  func load(_ url: URL) async {
    switch states[url] {
    case .loading, .loaded: return
    case .failed, nil: states[url] = .loading
    }
    switch await loader(url) {
    case .loaded(let data, let type):
      states[url] = .loaded("data:\(type);base64,\(data.base64EncodedString())")
    case .failed(let reason):
      states[url] = .failed(reason)
    }
  }
}
