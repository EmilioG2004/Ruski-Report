//
//  HomeViewState.swift
//  Ruski Report
//
//  Defines immutable presentation state for the score-first home experience.
//  Match grouping lives here so rendering remains declarative and inexpensive.
//

nonisolated enum HomeViewState: Equatable {
    case idle
    case loading
    case loaded(HomeScreen)
    case canonicalLoaded(PublicHomeScreen)
    case failed(message: String)

    var tournament: TournamentPreview? {
        guard case .loaded(let screen) = self else {
            return nil
        }

        return screen.tournament
    }
}

nonisolated struct PublicHomeScreen: Equatable {
    let tournaments: [PublicTournamentSummary]
    let detailsByTournamentId: [String: PublicTournamentDetail]

    func detail(for tournamentId: PublicTournamentSummary.ID) -> PublicTournamentDetail? {
        detailsByTournamentId[tournamentId]
    }
}

nonisolated struct HomeScreen: Equatable {
    let tournament: TournamentPreview
    let detail: TournamentDetail?

    var liveMatches: [MatchPreview] {
        matches.filter { $0.status == .inProgress }
    }

    var upcomingMatches: [MatchPreview] {
        matches.filter { $0.status == .scheduled }
    }

    var completedMatches: [MatchPreview] {
        matches.filter { $0.status == .final }
    }

    var matchSections: [HomeMatchSection] {
        HomeMatchSection.Kind.allCases.compactMap { kind in
            let sectionMatches = matches.filter { kind.includes($0.status) }
            return sectionMatches.isEmpty
                ? nil
                : HomeMatchSection(kind: kind, matches: sectionMatches)
        }
    }

    private var matches: [MatchPreview] {
        detail?.matches ?? []
    }
}

nonisolated struct HomeMatchSection: Identifiable, Equatable {
    let kind: Kind
    let matches: [MatchPreview]

    var id: Kind { kind }
    var title: String { kind.title }
    var subtitle: String? { kind.subtitle }

    enum Kind: String, CaseIterable, Identifiable {
        case live
        case upcoming
        case completed

        var id: String { rawValue }

        var title: String {
            switch self {
            case .live: HomeCopy.liveTitle
            case .upcoming: HomeCopy.upcomingTitle
            case .completed: HomeCopy.completedTitle
            }
        }

        var subtitle: String? {
            switch self {
            case .live: HomeCopy.liveSubtitle
            case .upcoming: HomeCopy.upcomingSubtitle
            case .completed: nil
            }
        }

        func includes(_ status: MatchStatus) -> Bool {
            switch (self, status) {
            case (.live, .inProgress), (.upcoming, .scheduled), (.completed, .final):
                true
            default:
                false
            }
        }
    }
}
