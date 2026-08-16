//
//  CommentReportingAuthorizationPolicy.swift
//  Ruski Report
//

import Foundation

nonisolated struct CommentReportingAuthorizationPolicy {
    private let signInMessage: String

    init(signInMessage: String = "Sign in to report comments.") {
        self.signInMessage = signInMessage
    }

    func authorization(for session: UserSession) -> CommentReportingAuthorization {
        session.canReportComments
            ? .allowed
            : .requiresSignIn(message: signInMessage)
    }
}

nonisolated enum CommentReportingAuthorization: Equatable {
    case allowed
    case requiresSignIn(message: String)

    var allowsReporting: Bool {
        switch self {
        case .allowed:
            true
        case .requiresSignIn:
            false
        }
    }
}
