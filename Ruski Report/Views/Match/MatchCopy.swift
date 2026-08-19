//
//  MatchCopy.swift
//  Ruski Report
//
//  Centralizes user-facing game-center language so layout components stay
//  reusable and terminology can evolve independently.
//

enum MatchCopy {
    static let navigationTitle = "Game"
    static let loadingTitle = "Loading game"
    static let loadingMessage = "Fetching the official scorecard and game activity."
    static let unavailableTitle = "Game unavailable"

    static let gameCenter = "GAME CENTER"
    static let overviewTitle = "At a glance"
    static let overviewSubtitle = "The current state of this official game."
    static let statusMetric = "Status"
    static let phaseMetric = "Phase"
    static let playsMetric = "Plays"
    static let commentsMetric = "Comments"
    static let notStarted = "Not started"
    static let commentsTitle = "Comments"
    static let conversationSubtitle = "Game conversation"
    static let loadingComments = "Loading comments"
    static let loadingCommentsMessage = "Fetching the latest game conversation."
    static let noComments = "No comments yet"
    static let commentPlaceholder = "Add a comment"
    static let postComment = "Post Comment"
    static let signIn = "Sign In"
    static let signInToComment = "Sign In to Comment"

    static let eventLogTitle = "Shot & Event Log"
    static let eventLogUnavailable = "Event log is not available yet"
    static let scorecardTitle = "Scorecard"
    static let scorecardUnavailable = "Scorecard rows are not available yet"
    static let unknownTeam = "Unknown team"
    static let unknownShooter = "Unknown shooter"
    static let unrecordedShot = "No result recorded"

    static func turnTitle(_ number: Int) -> String {
        "TURN \(number)"
    }

    static func shotTitle(_ position: Int) -> String {
        "Shot \(position)"
    }

    static func shootingOrder(_ order: Int) -> String {
        switch order {
        case 1: "Shoots first"
        case 2: "Shoots second"
        default: "Shooting order \(order)"
        }
    }
}
