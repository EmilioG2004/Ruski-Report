//
//  APIErrorMapper.swift
//  Ruski Report
//

import Foundation

nonisolated enum APIErrorMapper {
    static func map(_ dto: APIErrorResponseDTO) -> AppError {
        AppError.backend(
            code: dto.code,
            message: dto.message,
            details: dto.details.map {
                AppErrorDetail(
                    code: $0.code,
                    message: $0.message,
                    path: $0.path
                )
            }
        )
    }
}
