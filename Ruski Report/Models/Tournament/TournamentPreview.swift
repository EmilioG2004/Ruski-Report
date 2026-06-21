//
//  TournamentPreview.swift
//  Ruski Report
//

import Foundation

nonisolated struct TournamentPreview: Identifiable, Equatable {
    let id: String
    let year: Int
    let name: String
    let status: TournamentPreviewStatus
    let formatSummary: String
    let locationName: String
    let featuredMatchCount: Int
}

nonisolated enum TournamentPreviewStatus: Equatable {
    case scheduled
    case active
    case completed
    case archived
    case unknown(String)

    var displayName: String {
        switch self {
        case .scheduled:
            "Scheduled"
        case .active:
            "Active"
        case .completed:
            "Completed"
        case .archived:
            "Archived"
        case .unknown(let value):
            value.isEmpty ? "Unknown" : value.capitalized
        }
    }
}
