//
//  MatchCommentsViewState.swift
//  Ruski Report
//

import Foundation

nonisolated enum MatchCommentsViewState: Equatable {
    case loading
    case loaded(MatchCommentsContent)
    case failed(message: String)
}

nonisolated struct MatchCommentsContent: Equatable {
    let comments: [MatchComment]
    let postingAuthorization: CommentPostingAuthorization
    let isPosting: Bool
    let postErrorMessage: String?

    func posting(_ isPosting: Bool) -> MatchCommentsContent {
        MatchCommentsContent(
            comments: comments,
            postingAuthorization: postingAuthorization,
            isPosting: isPosting,
            postErrorMessage: nil
        )
    }

    func updated(
        comments: [MatchComment]? = nil,
        postErrorMessage: String? = nil
    ) -> MatchCommentsContent {
        MatchCommentsContent(
            comments: comments ?? self.comments,
            postingAuthorization: postingAuthorization,
            isPosting: false,
            postErrorMessage: postErrorMessage
        )
    }
}
