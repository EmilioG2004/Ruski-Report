//
//  StubSessionRepository.swift
//  Ruski ReportTests
//

@testable import Ruski_Report

final class StubSessionRepository: SessionRepository {
    private let session: UserSession

    init(session: UserSession = .guest) {
        self.session = session
    }

    func currentSession() async -> UserSession {
        session
    }
}
