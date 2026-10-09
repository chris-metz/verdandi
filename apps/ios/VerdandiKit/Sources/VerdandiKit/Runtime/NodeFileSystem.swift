import Foundation

/// The file operations the core's host asks for in place of Node's
/// `fs/promises` (`apps/ios/host/shims/fs-promises.ts`), done at once with
/// POSIX calls, and failing as Node does: with its error code, such as
/// `ENOENT`, and a message naming the call and the path.
enum NodeFileSystem {
    /// Runs one operation, its arguments as a JSON array, answering JSON.
    static func run(_ operation: String, argsJSON: String) -> String {
        let answer: [String: Any]
        do {
            guard let args = try JSONSerialization.jsonObject(with: Data(argsJSON.utf8)) as? [Any] else {
                throw FileError(code: "EINVAL", message: "EINVAL: invalid arguments, \(operation)")
            }
            answer = ["ok": true, "value": try perform(operation, args) ?? NSNull()]
        } catch let error as FileError {
            answer = ["ok": false, "code": error.code, "message": error.message]
        } catch {
            answer = ["ok": false, "code": "EIO", "message": error.localizedDescription]
        }
        let data = (try? JSONSerialization.data(withJSONObject: answer)) ?? Data("{\"ok\":false,\"code\":\"EIO\",\"message\":\"\"}".utf8)
        return String(decoding: data, as: UTF8.self)
    }

    struct FileError: Error {
        var code: String
        var message: String
    }

    private static func perform(_ operation: String, _ args: [Any]) throws -> Any? {
        guard let path = args.first as? String else {
            throw FileError(code: "EINVAL", message: "EINVAL: no path, \(operation)")
        }
        switch operation {
        case "readFile": return try readFile(path)
        case "writeFile":
            try writeFile(
                path, text: args[safe: 1] as? String ?? "", flag: args[safe: 2] as? String ?? "w",
                mode: (args[safe: 3] as? NSNumber)?.intValue)
            return nil
        case "rename":
            let to = args[safe: 1] as? String ?? ""
            guard Darwin.rename(path, to) == 0 else { throw posixError("rename", path, to: to) }
            return nil
        case "rm":
            try remove(path, force: args[safe: 1] as? Bool ?? false, recursive: args[safe: 2] as? Bool ?? false)
            return nil
        case "lstat": return try statValue(path, follow: false)
        case "stat": return try statValue(path, follow: true)
        case "mkdir":
            try makeDirectory(path, recursive: args[safe: 1] as? Bool ?? false)
            return nil
        case "realpath":
            guard let resolved = Darwin.realpath(path, nil) else { throw posixError("realpath", path) }
            defer { free(resolved) }
            return String(cString: resolved)
        default:
            throw FileError(code: "ENOSYS", message: "ENOSYS: \(operation) is not available")
        }
    }

    private static func readFile(_ path: String) throws -> String {
        let descriptor = open(path, O_RDONLY | O_CLOEXEC)
        guard descriptor >= 0 else { throw posixError("open", path) }
        defer { close(descriptor) }
        var info = stat()
        if fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFDIR {
            throw FileError(code: "EISDIR", message: "EISDIR: illegal operation on a directory, read")
        }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let count = buffer.withUnsafeMutableBytes { read(descriptor, $0.baseAddress, $0.count) }
            if count < 0 {
                if errno == EINTR { continue }
                throw posixError("read", path)
            }
            if count == 0 { break }
            data.append(contentsOf: buffer[0..<count])
        }
        return String(decoding: data, as: UTF8.self)
    }

    private static func writeFile(_ path: String, text: String, flag: String, mode: Int?) throws {
        var flags = O_WRONLY | O_CREAT | O_CLOEXEC
        switch flag {
        case "wx": flags |= O_EXCL | O_TRUNC
        case "a": flags |= O_APPEND
        case "ax": flags |= O_APPEND | O_EXCL
        default: flags |= O_TRUNC
        }
        let descriptor = open(path, flags, mode_t(mode ?? 0o666))
        guard descriptor >= 0 else { throw posixError("open", path) }
        defer { close(descriptor) }
        let bytes = Array(text.utf8)
        var written = 0
        while written < bytes.count {
            let count = bytes.withUnsafeBytes {
                write(descriptor, $0.baseAddress!.advanced(by: written), bytes.count - written)
            }
            if count < 0 {
                if errno == EINTR { continue }
                throw posixError("write", path)
            }
            written += count
        }
    }

    private static func remove(_ path: String, force: Bool, recursive: Bool) throws {
        var info = stat()
        guard lstat(path, &info) == 0 else {
            if errno == ENOENT && force { return }
            throw posixError("rm", path)
        }
        if info.st_mode & S_IFMT == S_IFDIR {
            guard recursive else {
                throw FileError(code: "ERR_FS_EISDIR", message: "Path is a directory: rm returned EISDIR (is a directory) \(path)")
            }
            do {
                try FileManager.default.removeItem(atPath: path)
            } catch {
                throw FileError(code: "EIO", message: "EIO: \(error.localizedDescription), rm '\(path)'")
            }
            return
        }
        guard unlink(path) == 0 else { throw posixError("rm", path) }
    }

    private static func statValue(_ path: String, follow: Bool) throws -> [String: Any] {
        var info = stat()
        let result = follow ? stat(path, &info) : lstat(path, &info)
        guard result == 0 else { throw posixError(follow ? "stat" : "lstat", path) }
        let type: String =
            switch info.st_mode & S_IFMT {
            case S_IFDIR: "directory"
            case S_IFREG: "file"
            case S_IFLNK: "link"
            default: "other"
            }
        return ["mode": Int(info.st_mode), "size": Int(info.st_size), "type": type]
    }

    private static func makeDirectory(_ path: String, recursive: Bool) throws {
        guard recursive else {
            guard mkdir(path, 0o777) == 0 else { throw posixError("mkdir", path) }
            return
        }
        var missing: [String] = []
        var current = path
        while true {
            var info = stat()
            if stat(current, &info) == 0 {
                guard info.st_mode & S_IFMT == S_IFDIR else {
                    errno = current == path ? EEXIST : ENOTDIR
                    throw posixError("mkdir", path)
                }
                break
            }
            missing.insert(current, at: 0)
            let parent = (current as NSString).deletingLastPathComponent
            if parent == current || parent.isEmpty { break }
            current = parent
        }
        for folder in missing where mkdir(folder, 0o777) != 0 && errno != EEXIST {
            throw posixError("mkdir", path)
        }
    }

    /// The error of the last POSIX call, as Node words it.
    private static func posixError(_ call: String, _ path: String, to: String? = nil) -> FileError {
        let number = errno
        let code = codes[number] ?? "E\(number)"
        let description = String(cString: strerror(number)).lowercased()
        let paths = to.map { "'\(path)' -> '\($0)'" } ?? "'\(path)'"
        return FileError(code: code, message: "\(code): \(description), \(call) \(paths)")
    }

    private static let codes: [Int32: String] = [
        ENOENT: "ENOENT", EEXIST: "EEXIST", EACCES: "EACCES", EPERM: "EPERM",
        ENOTDIR: "ENOTDIR", EISDIR: "EISDIR", ENOTEMPTY: "ENOTEMPTY", EBUSY: "EBUSY",
        EINVAL: "EINVAL", EIO: "EIO", ENOSPC: "ENOSPC", EROFS: "EROFS", ELOOP: "ELOOP",
        ENAMETOOLONG: "ENAMETOOLONG", EMFILE: "EMFILE", EXDEV: "EXDEV",
    ]
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
