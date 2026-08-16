//
//  GameDefinitionMapper.swift
//  Ruski Report
//

import Foundation

nonisolated enum GameDefinitionMapper {
    static func map(_ dto: GameDefinitionDTO) -> GameDefinition {
        GameDefinition(
            gameType: dto.gameType,
            displayName: dto.displayName,
            scorecardDefinitionId: dto.scorecardDefinitionId,
            phases: dto.phases.map(mapPhase),
            eventTypes: dto.eventTypes.map(mapEventType),
            stats: dto.stats.map(mapStat)
        )
    }

    private static func mapPhase(
        _ dto: GamePhaseDefinitionDTO
    ) -> GamePhaseDefinition {
        GamePhaseDefinition(
            id: dto.id,
            label: dto.label,
            sequence: dto.sequence
        )
    }

    private static func mapEventType(
        _ dto: GameEventTypeDefinitionDTO
    ) -> GameEventTypeDefinition {
        GameEventTypeDefinition(
            id: dto.id,
            label: dto.label,
            category: dto.category,
            affectsScore: dto.affectsScore ?? false,
            countsAsAttempt: dto.countsAsAttempt ?? false,
            statKey: dto.statKey
        )
    }

    private static func mapStat(
        _ dto: GameStatDefinitionDTO
    ) -> GameStatDefinition {
        GameStatDefinition(
            key: dto.key,
            label: dto.label,
            scope: dto.scope,
            valueType: dto.valueType
        )
    }
}
