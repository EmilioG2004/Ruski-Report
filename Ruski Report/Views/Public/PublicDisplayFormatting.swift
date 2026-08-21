//
//  PublicDisplayFormatting.swift
//  Ruski Report
//
//  Keeps canonical lifecycle, score, and schedule language consistent without
//  leaking transport values into view composition.
//

import Foundation

extension PublicTournamentLifecycle {
    var displayName: String {
        switch self {
        case .draftSetup: "Draft"
        case .setupPublished: "Setup Published"
        case .podPlay: "Pod Play"
        case .seedingReview: "Seeding Review"
        case .playoffs: "Playoffs"
        case .completed: "Completed"
        case .archived: "Archived"
        }
    }
}

extension PublicMatchStatus {
    var displayName: String {
        switch self {
        case .scheduled: "Scheduled"
        case .inProgress: "Live"
        case .final: "Final"
        case .forfeited: "Forfeit"
        case .cancelled: "Cancelled"
        case .postponed: "Postponed"
        }
    }

    var systemImage: String {
        switch self {
        case .scheduled: "clock"
        case .inProgress: "dot.radiowaves.left.and.right"
        case .final: "checkmark.circle.fill"
        case .forfeited: "flag.checkered"
        case .cancelled: "xmark.circle"
        case .postponed: "calendar.badge.clock"
        }
    }

    var pillStyle: StatusPill.Style {
        switch self {
        case .inProgress: .live
        case .final, .forfeited: .final
        case .scheduled, .postponed: .scheduled
        case .cancelled: .neutral
        }
    }
}

extension PublicScoreAvailability {
    var displayName: String {
        switch self {
        case .notStarted: "Score not started"
        case .partial: "Partial score"
        case .complete: "Official score"
        case .unrecorded: "Scorecard unavailable"
        case .notApplicable: "Score not applicable"
        }
    }
}

extension PublicStandingState {
    var displayName: String {
        switch self {
        case .zeroGame: "No games played"
        case .active: "Provisional"
        case .finalized: "Finalized"
        case .unresolvedTie: "Tie needs resolution"
        }
    }
}

extension PublicMatchSummary {
    var scheduleDisplay: String {
        guard let scheduledAt = timestamps.scheduledAt else {
            return status == .scheduled ? "Schedule TBD" : stageDisplayName
        }

        return Self.displayDate(scheduledAt) ?? "Scheduled time unavailable"
    }

    var stageDisplayName: String {
        switch stage {
        case .podPlay: "Pod play"
        case .playoffs: "Playoffs"
        }
    }

    var contextDisplay: String {
        if let bracketMatchId {
            return "\(stageDisplayName) · \(bracketMatchId)"
        }
        if let podId {
            return "\(stageDisplayName) · \(podId)"
        }
        return stageDisplayName
    }

    private static func displayDate(_ value: String) -> String? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
        return date?.formatted(
            date: .abbreviated,
            time: .shortened
        )
    }
}

enum PublicDisplayValueFormatter {
    static func readableLabel(_ value: String) -> String {
        value
            .replacingOccurrences(
                of: "([a-z0-9])([A-Z])",
                with: "$1 $2",
                options: .regularExpression
            )
            .replacingOccurrences(of: "_", with: " ")
            .split(separator: " ")
            .map { $0.capitalized }
            .joined(separator: " ")
    }

    static func number(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "–" }
        if value.rounded() == value {
            return Int(value).formatted()
        }
        return value.formatted(.number.precision(.fractionLength(0...2)))
    }

    static func percentage(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "–" }
        return value.formatted(.percent.precision(.fractionLength(0...1)))
    }

    static func json(_ value: JSONValue?) -> String {
        guard let value else { return "–" }
        switch value {
        case .string(let value): return value
        case .number(let value): return number(value)
        case .bool(let value): return value ? "Yes" : "No"
        case .null: return "–"
        case .array, .object: return "Details"
        }
    }
}
