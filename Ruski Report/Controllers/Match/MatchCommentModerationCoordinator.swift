//
//  MatchCommentModerationCoordinator.swift
//  Ruski Report
//
//  Coordinates report and block presentation policy. Keeping this workflow out
//  of views lets comment rows remain reusable and isolates authorization rules.
//

import Combine

@MainActor
final class MatchCommentModerationCoordinator: ObservableObject {
    @Published var selectedReport: CommentReportPresentation?
    @Published var selectedBlock: BlockUserPresentation?

    let reportingController: CommentReportingController

    private let session: AccountSessionStore
    private let userBlocking: UserBlockingStore

    init(
        reports: any CommentReportingRepository,
        session: AccountSessionStore,
        userBlocking: UserBlockingStore,
        logger: any AppLogger
    ) {
        self.session = session
        self.userBlocking = userBlocking
        reportingController = CommentReportingController(
            reports: reports,
            session: session,
            logger: logger
        )
    }

    func beginReport(for comment: MatchComment, showAccount: () -> Void) {
        guard session.current.canReportComments else {
            showAccount()
            return
        }

        reportingController.reset()
        selectedReport = CommentReportPresentation(
            commentId: comment.id,
            authorDisplayName: comment.authorDisplayName
        )
    }

    func blockAction(
        for comment: MatchComment,
        showAccount: @escaping () -> Void
    ) -> (() -> Void)? {
        guard let authorUserID = comment.authorUserId,
              authorUserID != session.current.profile?.id else {
            return nil
        }

        return { [weak self] in
            self?.beginBlock(
                BlockUserPresentation(
                    id: authorUserID,
                    displayName: comment.authorDisplayName
                ),
                showAccount: showAccount
            )
        }
    }

    func confirmBlock(_ user: BlockUserPresentation) async -> UserBlockingOutcome {
        selectedBlock = nil
        return await userBlocking.block(user)
    }

    var blockDialogTitle: String {
        selectedBlock.map { "Block \($0.displayName)?" } ?? "Block User?"
    }

    private func beginBlock(
        _ user: BlockUserPresentation,
        showAccount: () -> Void
    ) {
        guard session.current.canBlockUsers else {
            showAccount()
            return
        }

        userBlocking.clearMessages()
        selectedBlock = user
    }
}
