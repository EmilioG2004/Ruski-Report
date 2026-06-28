//
//  LocalSessionRepository.swift
//  Ruski Report
//

import Combine
import Foundation

final class LocalSessionRepository: ObservableObject, SessionRepository {
    @Published private(set) var current: UserSession

    private let configuration: LocalSessionConfiguration
    private let logger: any AppLogger
    private let idFactory: () -> String

    init(
        initialSession: UserSession = .guest,
        configuration: LocalSessionConfiguration = .default,
        logger: any AppLogger = NoopAppLogger(),
        idFactory: @escaping () -> String = { "local-\(UUID().uuidString)" }
    ) {
        self.current = initialSession
        self.configuration = configuration
        self.logger = logger
        self.idFactory = idFactory
    }

    func currentSession() async -> UserSession {
        current
    }

    @discardableResult
    func signIn(displayName: String) -> Result<UserSession, LocalSessionValidationError> {
        switch configuration.validatedDisplayName(displayName) {
        case .success(let validatedDisplayName):
            let session = UserSession.authenticated(
                UserProfile(
                    id: idFactory(),
                    displayName: validatedDisplayName,
                    provider: .localAccount
                )
            )
            updateSession(session)
            logger.log(
                .info,
                "Local account session signed in",
                metadata: ["sessionKind": session.kind.rawValue]
            )
            return .success(session)
        case .failure(let error):
            logger.log(
                .warning,
                "Local account sign in rejected",
                metadata: ["reason": error.message]
            )
            return .failure(error)
        }
    }

    func signOut() {
        let previousKind = current.kind
        guard previousKind != .guest else {
            return
        }

        updateSession(.guest)
        logger.log(
            .info,
            "Local account session signed out",
            metadata: ["previousSessionKind": previousKind.rawValue]
        )
    }

    private func updateSession(_ session: UserSession) {
        current = session
    }
}

nonisolated struct LocalSessionConfiguration: Equatable {
    let maximumDisplayNameLength: Int
    let emptyDisplayNameMessage: String

    static let `default` = LocalSessionConfiguration(
        maximumDisplayNameLength: 40,
        emptyDisplayNameMessage: "Enter a display name."
    )

    func validatedDisplayName(
        _ displayName: String
    ) -> Result<String, LocalSessionValidationError> {
        let trimmedName = displayName.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmedName.isEmpty else {
            return .failure(.invalid(message: emptyDisplayNameMessage))
        }

        guard trimmedName.count <= maximumDisplayNameLength else {
            return .failure(
                .invalid(
                    message: "Display names must be \(maximumDisplayNameLength) characters or fewer."
                )
            )
        }

        return .success(trimmedName)
    }
}

nonisolated enum LocalSessionValidationError: Error, Equatable {
    case invalid(message: String)

    var message: String {
        switch self {
        case .invalid(let message):
            message
        }
    }
}
