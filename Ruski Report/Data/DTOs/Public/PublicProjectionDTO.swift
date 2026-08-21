//
//  PublicProjectionDTO.swift
//  Ruski Report
//

import Foundation

nonisolated struct PublicProjectionDTO: Decodable, Equatable {
    let tournamentId: String
    let version: Int64
    let activatedAt: String
    let source: String
}

nonisolated struct PublicTournamentDiscoveryItemDTO: Decodable, Equatable {
    let projection: PublicProjectionDTO
    let tournament: PublicTournamentSummaryDTO
}

nonisolated struct PublicTournamentDiscoveryEnvelopeDTO: Decodable, Equatable {
    let contractVersion: Int
    let tournaments: [PublicTournamentDiscoveryItemDTO]
}

nonisolated struct PublicTournamentDetailEnvelopeDTO: Decodable, Equatable {
    let contractVersion: Int
    let projection: PublicProjectionDTO
    let tournament: PublicTournamentDTO
}

nonisolated struct PublicMatchListEnvelopeDTO: Decodable, Equatable {
    let contractVersion: Int
    let projection: PublicProjectionDTO
    let matches: [PublicMatchSummaryDTO]
}

nonisolated struct PublicMatchDetailEnvelopeDTO: Decodable, Equatable {
    let contractVersion: Int
    let projection: PublicProjectionDTO
    let match: PublicMatchDTO
}
