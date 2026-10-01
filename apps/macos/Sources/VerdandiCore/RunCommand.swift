import Foundation

public enum CommandResult: Sendable {
  case exited(code: Int32, stdout: Data, stderr: String)
  /// There is no executable at the path.
  case notFound
  case failedToStart(String)
  case timedOut
}

/// Runs an executable without a shell, writing `input` to its standard
/// input. One that outlives `timeout` is terminated.
public func runCommand(
  _ executable: URL,
  _ arguments: [String],
  input: Data? = nil,
  timeout: Duration? = nil
) async -> CommandResult {
  _ = ignoreBrokenPipes
  guard FileManager.default.isExecutableFile(atPath: executable.path) else {
    return FileManager.default.fileExists(atPath: executable.path)
      ? .failedToStart("\(executable.path) is not executable.") : .notFound
  }
  let process = Process()
  process.executableURL = executable
  process.arguments = arguments
  var environment = ProcessInfo.processInfo.environment
  // gh's own prompts and colours would only get in the way.
  environment["GH_PROMPT_DISABLED"] = "1"
  environment["NO_COLOR"] = "1"
  environment["GH_NO_UPDATE_NOTIFIER"] = "1"
  process.environment = environment
  let stdout = Pipe()
  let stderr = Pipe()
  let stdin = Pipe()
  process.standardOutput = stdout
  process.standardError = stderr
  process.standardInput = stdin

  let (exits, exited) = AsyncStream<Int32>.makeStream()
  process.terminationHandler = { process in
    exited.yield(process.terminationStatus)
    exited.finish()
  }
  do {
    try process.run()
  } catch {
    return .failedToStart(error.localizedDescription)
  }
  let output = readToEnd(stdout.fileHandleForReading)
  let errors = readToEnd(stderr.fileHandleForReading)
  let writer = stdin.fileHandleForWriting
  if let input { try? writer.write(contentsOf: input) }
  try? writer.close()

  let timedOut = Flag()
  let running = UncheckedSendable(process)
  let watchdog = timeout.map { timeout in
    Task {
      try await Task.sleep(for: timeout)
      timedOut.set()
      running.value.terminate()
    }
  }
  var code: Int32 = -1
  for await status in exits { code = status }
  watchdog?.cancel()
  let out = await output.value
  let err = await errors.value
  if timedOut.isSet { return .timedOut }
  return .exited(code: code, stdout: out, stderr: String(decoding: err, as: UTF8.self))
}

/// Reads a pipe to its end on a thread of its own, as reading blocks.
private func readToEnd(_ handle: FileHandle) -> Task<Data, Never> {
  let handle = UncheckedSendable(handle)
  return Task {
    await withCheckedContinuation { continuation in
      DispatchQueue.global(qos: .userInitiated).async {
        continuation.resume(returning: handle.value.readDataToEndOfFile())
      }
    }
  }
}

/// A child that exits before reading its input must not take the app along.
private let ignoreBrokenPipes: Void = {
  signal(SIGPIPE, SIG_IGN)
}()

final class Flag: @unchecked Sendable {
  private let lock = NSLock()
  private var value = false

  func set() { lock.withLock { value = true } }
  var isSet: Bool { lock.withLock { value } }
}

struct UncheckedSendable<Value>: @unchecked Sendable {
  let value: Value
  init(_ value: Value) { self.value = value }
}
