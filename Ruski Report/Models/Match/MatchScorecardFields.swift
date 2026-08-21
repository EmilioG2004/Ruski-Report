//
//  MatchScorecardFields.swift
//  Ruski Report
//
//  Names the generic scorecard identity fields consumed by chronological
//  projections while leaving all result columns server-driven and extensible.
//

nonisolated enum MatchScorecardField {
    static let shotNumber = "shotNumber"
    static let shooter = "shooter"
    static let identityKeys: Set<String> = [shotNumber, shooter]
}
