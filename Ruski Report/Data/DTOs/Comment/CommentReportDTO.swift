//
//  CommentReportDTO.swift
//  Ruski Report
//

import Foundation

nonisolated struct SubmitCommentReportRequestDTO: Encodable, Equatable {
    let reason: String
    let context: String?
}

nonisolated struct CommentReportReceiptDTO: Decodable, Equatable {
    let id: String
    let status: String
    let submittedAt: String
    let alreadyReported: Bool
}
