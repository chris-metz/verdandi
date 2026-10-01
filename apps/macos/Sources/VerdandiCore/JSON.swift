import Foundation

/// A JSON value, read from GitHub's answers or written to settings.json.
public enum JSON: Sendable, Hashable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSON])
  case object([String: JSON])

  public init(parsing data: Data) throws {
    let value = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    self = JSON(foundation: value)
  }

  public init(parsing text: String) throws {
    try self.init(parsing: Data(text.utf8))
  }

  init(foundation value: Any) {
    switch value {
    case let number as NSNumber:
      if CFGetTypeID(number) == CFBooleanGetTypeID() {
        self = .bool(number.boolValue)
      } else {
        self = .number(number.doubleValue)
      }
    case let string as String: self = .string(string)
    case let array as [Any]: self = .array(array.map(JSON.init(foundation:)))
    case let object as [String: Any]: self = .object(object.mapValues(JSON.init(foundation:)))
    default: self = .null
    }
  }

  public subscript(key: String) -> JSON? {
    if case .object(let object) = self { return object[key] }
    return nil
  }

  public subscript(index: Int) -> JSON? {
    if case .array(let array) = self, array.indices.contains(index) { return array[index] }
    return nil
  }

  public var string: String? {
    if case .string(let value) = self { return value }
    return nil
  }

  public var int: Int? {
    if case .number(let value) = self, value.rounded() == value, abs(value) < 9e15 {
      return Int(value)
    }
    return nil
  }

  public var double: Double? {
    if case .number(let value) = self { return value }
    return nil
  }

  public var bool: Bool? {
    if case .bool(let value) = self { return value }
    return nil
  }

  public var array: [JSON]? {
    if case .array(let value) = self { return value }
    return nil
  }

  public var object: [String: JSON]? {
    if case .object(let value) = self { return value }
    return nil
  }

  public var isNull: Bool {
    if case .null = self { return true }
    return false
  }

  var foundation: Any {
    switch self {
    case .null: NSNull()
    case .bool(let value): value
    case .number(let value): value.rounded() == value && abs(value) < 9e15 ? Int(value) as Any : value
    case .string(let value): value
    case .array(let value): value.map(\.foundation)
    case .object(let value): value.mapValues(\.foundation)
    }
  }

  /// The value as JSON text, keys sorted unless `pretty` is false.
  public func serialized(pretty: Bool = false) -> Data {
    var options: JSONSerialization.WritingOptions = [.fragmentsAllowed, .withoutEscapingSlashes]
    if pretty { options.formUnion([.prettyPrinted, .sortedKeys]) }
    return (try? JSONSerialization.data(withJSONObject: foundation, options: options)) ?? Data("null".utf8)
  }
}

extension JSON: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral, ExpressibleByBooleanLiteral,
  ExpressibleByNilLiteral
{
  public init(stringLiteral value: String) { self = .string(value) }
  public init(integerLiteral value: Int) { self = .number(Double(value)) }
  public init(booleanLiteral value: Bool) { self = .bool(value) }
  public init(nilLiteral: ()) { self = .null }
}

extension JSON {
  public init(_ value: String?) { self = value.map(JSON.string) ?? .null }
  public init(_ value: Int?) { self = value.map { .number(Double($0)) } ?? .null }
  public init(_ values: [String]) { self = .array(values.map(JSON.string)) }
}
