//
//  GameDefinitionDTO.swift
//  Ruski Report
//

import Foundation

nonisolated struct GameDefinitionDTO: Decodable, Equatable {
    let gameType: String
    let displayName: String
    let scorecardDefinitionId: String
    let phases: [GamePhaseDefinitionDTO]
    let eventTypes: [GameEventTypeDefinitionDTO]
    let stats: [GameStatDefinitionDTO]
}

nonisolated struct GamePhaseDefinitionDTO: Decodable, Equatable {
    let id: String
    let label: String
    let sequence: Int
}

nonisolated struct GameEventTypeDefinitionDTO: Decodable, Equatable {
    let id: String
    let label: String
    let category: String
    let affectsScore: Bool
    let countsAsAttempt: Bool
    let statKey: String?
}

nonisolated struct GameStatDefinitionDTO: Decodable, Equatable {
    let key: String
    let label: String
    let scope: String
    let valueType: String
}
