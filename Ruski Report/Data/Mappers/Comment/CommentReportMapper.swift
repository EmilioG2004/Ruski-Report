//
//  CommentReportMapper.swift
//  Ruski Report
//

import Foundation

nonisolated enum CommentReportMapper {
    static func map(_ dto: CommentReportReceiptDTO) -> CommentReportReceipt {
        CommentReportReceipt(
            id: dto.id,
            status: dto.status,
            submittedAt: dto.submittedAt,
            alreadyReported: dto.alreadyReported
        )
    }
}
