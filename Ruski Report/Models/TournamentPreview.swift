//
//  TournamentPreview.swift
//  Ruski Report
//

import Foundation

struct TournamentPreview: Identifiable, Equatable {
    let id: String
    let year: Int
    let name: String
    let status: TournamentPreviewStatus
    let formatSummary: String
    let locationName: String
    let featuredMatchCount: Int
}

enum TournamentPreviewStatus: String, Equatable {
    case scheduled
    case active
    case completed

    var displayName: String {
        switch self {
        case .scheduled:
            "Scheduled"
        case .active:
            "Active"
        case .completed:
            "Completed"
        }
    }
}
