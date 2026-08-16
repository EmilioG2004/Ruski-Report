//
//  StubCommentRepository.swift
//  Ruski ReportTests
//

@testable import Ruski_Report

struct StubCommentPostRequest: Equatable {
    let matchId: MatchPreview.ID
    let body: String
}

final class StubCommentRepository: CommentRepository {
    private static let defaultPostComment = MatchComment(
        id: "comment-default",
        matchId: PreviewData.openingMatch.id,
        authorDisplayName: "Alex",
        body: "Great match.",
        createdAt: "2026-06-21T00:18:00.000Z"
    )

    private let commentsResult: Result<[MatchComment], Error>
    private let postResult: Result<MatchComment, Error>
    private(set) var requestedMatchIds: [MatchPreview.ID] = []
    private(set) var postRequests: [StubCommentPostRequest] = []

    init(
        commentsResult: Result<[MatchComment], Error> = .success(
            PreviewData.matchComments
        ),
        postResult: Result<MatchComment, Error> = .success(
            StubCommentRepository.defaultPostComment
        )
    ) {
        self.commentsResult = commentsResult
        self.postResult = postResult
    }

    func comments(matchId: MatchPreview.ID) async throws -> [MatchComment] {
        requestedMatchIds.append(matchId)
        return try commentsResult.get()
    }

    func postComment(matchId: MatchPreview.ID, body: String) async throws -> MatchComment {
        postRequests.append(
            StubCommentPostRequest(matchId: matchId, body: body)
        )
        return try postResult.get()
    }
}
