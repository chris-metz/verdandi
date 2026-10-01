import Foundation

/// Watches a file for changes made by anyone, e.g. by hand in an editor or
/// by the Electron app. It watches the file itself, which sees an edit in
/// place, and its folder, which sees the file created, deleted or replaced
/// by an atomic write (a rename over it), after which the new file is
/// watched. Events are debounced, and `changed` is called only when the
/// file's contents, or whether it can be read, differ from what it saw last:
/// a write of the same contents, or a `touch`, is not a change.
///
/// `changed` runs on a queue of the watcher's own.
public final class FileWatcher: @unchecked Sendable {
  public let url: URL
  private let debounce: DispatchTimeInterval
  private let changed: @Sendable () -> Void
  private let queue = DispatchQueue(label: "verdandi.file-watcher", qos: .utility)

  // Touched on `queue` only.
  private var folderSource: (any DispatchSourceFileSystemObject)?
  private var fileSource: (any DispatchSourceFileSystemObject)?
  /// The inode the file source watches, to notice the file was replaced.
  private var watchedInode: UInt64?
  private var pending: DispatchWorkItem?
  /// The contents last seen, `nil` while the file cannot be read.
  private var observed: Data?
  private var started = false
  private var stopped = false

  public init(
    url: URL, debounce: DispatchTimeInterval = .milliseconds(150), changed: @escaping @Sendable () -> Void
  ) {
    self.url = url
    self.debounce = debounce
    self.changed = changed
  }

  deinit {
    folderSource?.cancel()
    fileSource?.cancel()
  }

  /// Starts watching; the file as it is now is what later changes are
  /// compared with. The folder is created if need be, as settings.json's
  /// folder may not exist before the first write.
  public func start() {
    queue.sync {
      guard !started, !stopped else { return }
      started = true
      let folder = url.deletingLastPathComponent()
      try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      observed = try? Data(contentsOf: url)
      folderSource = source(for: folder, events: .write)
      watchFile()
    }
  }

  public func stop() {
    queue.sync {
      stopped = true
      pending?.cancel()
      folderSource?.cancel()
      fileSource?.cancel()
      folderSource = nil
      fileSource = nil
    }
  }

  /// Takes the file's current contents as seen, e.g. right after writing
  /// it, so that the write is not reported as a change.
  public func acknowledge() {
    queue.async { [self] in
      observed = try? Data(contentsOf: url)
    }
  }

  // MARK: On the queue

  /// Watches the file at `url` now, unless it is already watched.
  private func watchFile() {
    let inode = Self.inode(of: url)
    guard inode != watchedInode || fileSource == nil else { return }
    fileSource?.cancel()
    fileSource = nil
    watchedInode = nil
    guard inode != nil else { return }
    fileSource = source(for: url, events: [.write, .extend, .delete, .rename, .revoke, .attrib])
    watchedInode = fileSource == nil ? nil : inode
  }

  private func source(
    for url: URL, events: DispatchSource.FileSystemEvent
  ) -> (any DispatchSourceFileSystemObject)? {
    let descriptor = open(url.path, O_EVTONLY)
    guard descriptor >= 0 else { return nil }
    let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: descriptor, eventMask: events, queue: queue)
    source.setEventHandler { [weak self] in self?.noticed() }
    source.setCancelHandler { close(descriptor) }
    source.resume()
    return source
  }

  /// Something happened to the file or its folder: look once things settle.
  private func noticed() {
    guard !stopped else { return }
    pending?.cancel()
    let check = DispatchWorkItem { [weak self] in self?.check() }
    pending = check
    queue.asyncAfter(deadline: .now() + debounce, execute: check)
  }

  private func check() {
    guard !stopped else { return }
    // A replaced or recreated file is a new inode to watch.
    watchFile()
    let contents = try? Data(contentsOf: url)
    guard contents != observed else { return }
    observed = contents
    changed()
  }

  private static func inode(of url: URL) -> UInt64? {
    var info = stat()
    guard stat(url.path, &info) == 0 else { return nil }
    return UInt64(info.st_ino)
  }
}
