//
//  CommentReportModels.swift
//  Ruski Report
//

import Foundation

nonisolated enum CommentReportReason: String, CaseIterable, Identifiable, Equatable {
    case harassment
    case hateOrDiscrimination = "hate_or_discrimination"
    case threatOrSelfHarm = "threat_or_self_harm"
    case sexualContent = "sexual_content"
    case spam
    case other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .harassment:
            "Harassment or bullying"
        case .hateOrDiscrimination:
            "Hate or discrimination"
        case .threatOrSelfHarm:
            "Threats or self-harm"
        case .sexualContent:
            "Sexual content"
        case .spam:
            "Spam"
        case .other:
            "Other"
        }
    }
}

nonisolated struct CommentReportReceipt: Equatable {
    let id: String
    let status: String
    let submittedAt: String
    let alreadyReported: Bool
}

nonisolated struct CommentReportPresentation: Identifiable, Equatable {
    let commentId: MatchComment.ID
    let authorDisplayName: String

    var id: MatchComment.ID { commentId }
}
