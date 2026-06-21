//
//  GameDefinition.swift
//  Ruski Report
//

import Foundation

nonisolated struct GameDefinition: Identifiable, Equatable {
    var id: String { gameType }

    let gameType: String
    let displayName: String
    let scorecardDefinitionId: String
    let phases: [GamePhaseDefinition]
    let eventTypes: [GameEventTypeDefinition]
    let stats: [GameStatDefinition]
}

nonisolated struct GamePhaseDefinition: Identifiable, Equatable {
    let id: String
    let label: String
    let sequence: Int
}

nonisolated struct GameEventTypeDefinition: Identifiable, Equatable {
    let id: String
    let label: String
    let category: String
    let affectsScore: Bool
    let countsAsAttempt: Bool
    let statKey: String?
}

nonisolated struct GameStatDefinition: Identifiable, Equatable {
    var id: String { key }

    let key: String
    let label: String
    let scope: String
    let valueType: String
}
