//
//  MatchDetailViewState.swift
//  Ruski Report
//

import Foundation

nonisolated enum MatchDetailViewState: Equatable {
    case loading
    case loaded(MatchDetailScreen)
    case failed(message: String)
}

nonisolated struct MatchDetailScreen: Equatable {
    let match: MatchDetail
    let gameDefinition: GameDefinition?

    var eventTypesById: [String: GameEventTypeDefinition] {
        Dictionary(
            uniqueKeysWithValues: (gameDefinition?.eventTypes ?? []).map {
                ($0.id, $0)
            }
        )
    }

    var statsByKey: [String: GameStatDefinition] {
        Dictionary(
            uniqueKeysWithValues: (gameDefinition?.stats ?? []).map {
                ($0.key, $0)
            }
        )
    }

    var boxScoreColumns: [BoxScoreStatColumn] {
        guard let boxScore = match.boxScore else {
            return []
        }

        let availableKeys = Set(
            boxScore.rows.flatMap { row in row.stats.keys } + boxScore.totals.keys
        )

        let definitionColumns = (gameDefinition?.stats ?? [])
            .filter { availableKeys.contains($0.key) }
            .map {
                BoxScoreStatColumn(
                    key: $0.key,
                    label: $0.label,
                    valueType: $0.valueType
                )
            }

        let definedKeys = Set(definitionColumns.map(\.key))
        let fallbackColumns = availableKeys
            .subtracting(definedKeys)
            .sorted()
            .map {
                BoxScoreStatColumn(
                    key: $0,
                    label: Self.readableLabel(from: $0),
                    valueType: "number"
                )
            }

        return definitionColumns + fallbackColumns
    }

    func eventLabel(for event: GameEvent) -> String {
        eventTypesById[event.type]?.label ?? Self.readableLabel(from: event.type)
    }

    static func readableLabel(from key: String) -> String {
        let spaced = key.reduce(into: "") { result, character in
            if character == "_" || character == "-" {
                result.append(" ")
            } else {
                if character.isUppercase && !result.isEmpty {
                    result.append(" ")
                }

                result.append(character)
            }
        }

        return spaced
            .split(separator: " ")
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }
}

nonisolated struct BoxScoreStatColumn: Identifiable, Equatable {
    var id: String { key }

    let key: String
    let label: String
    let valueType: String
}
