//
//  JSONValue.swift
//  Ruski Report
//

import Foundation

nonisolated enum JSONValue: Decodable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported JSON value."
            )
        }
    }

    var stringValue: String? {
        switch self {
        case .string(let value):
            value
        case .number(let value):
            String(value)
        case .bool(let value):
            String(value)
        case .object, .array, .null:
            nil
        }
    }

    var doubleValue: Double? {
        switch self {
        case .number(let value):
            value
        case .string(let value):
            Double(value)
        case .bool, .object, .array, .null:
            nil
        }
    }
}
