//
//  CommentAuthorizationPolicy.swift
//  Ruski Report
//

import Foundation

nonisolated struct CommentAuthorizationPolicy {
    private let signInMessage: String

    init(
        signInMessage: String = "Sign in to post comments."
    ) {
        self.signInMessage = signInMessage
    }

    func postingAuthorization(
        for session: UserSession
    ) -> CommentPostingAuthorization {
        guard session.canPostComments else {
            return .requiresSignIn(message: signInMessage)
        }

        return .allowed
    }
}

nonisolated enum CommentPostingAuthorization: Equatable {
    case allowed
    case requiresSignIn(message: String)

    var allowsPosting: Bool {
        switch self {
        case .allowed:
            true
        case .requiresSignIn:
            false
        }
    }
}
