//
//  TournamentDetailViewState.swift
//  Ruski Report
//

nonisolated enum TournamentDetailViewState: Equatable {
    case loading
    case loaded(TournamentDetailScreen)
    case canonicalLoaded(PublicTournamentDetail)
    case failed(message: String)
}

nonisolated struct TournamentDetailScreen: Equatable {
    let detail: TournamentDetail
    let gameDefinition: GameDefinition?

    func statisticColumns(
        for table: TournamentStatisticTable
    ) -> [TournamentStatisticColumn] {
        let definitionsByKey = Dictionary(
            uniqueKeysWithValues: (gameDefinition?.stats ?? []).map {
                ($0.key, $0)
            }
        )

        return table.statKeys.map { key in
            let definition = definitionsByKey[key]

            return TournamentStatisticColumn(
                key: key,
                label: definition?.label ?? MatchDetailScreen.readableLabel(from: key),
                valueType: definition?.valueType ?? "number"
            )
        }
    }
}

nonisolated struct TournamentStatisticColumn: Identifiable, Equatable {
    var id: String { key }

    let key: String
    let label: String
    let valueType: String
}
