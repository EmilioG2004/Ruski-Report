//
//  TournamentMatchContextFormatter.swift
//  Ruski Report
//
//  Provides one presentation policy for labeling a game's tournament context
//  across Home and Tournament score feeds.
//

enum TournamentMatchContextFormatter {
    static func label(
        for match: MatchPreview,
        in tournament: TournamentDetail
    ) -> String? {
        guard let podID = match.podId else {
            return AppSportsCopy.championshipBracket
        }

        return tournament.pods.first { $0.id == podID }?.name
    }
}
