//
//  AppLayout.swift
//  Ruski Report
//
//  Centralizes semantic dimensions so feature views express layout intent
//  without duplicating device-specific measurements.
//

import SwiftUI

enum AppLayout {
    static let hairlineWidth: CGFloat = 0.5
    static let liveIndicatorWidth: CGFloat = 4

    static let microSpacing: CGFloat = 4
    static let smallSpacing: CGFloat = 8
    static let compactSpacing: CGFloat = 10
    static let standardSpacing: CGFloat = 12
    static let contentSpacing: CGFloat = 14
    static let largeSpacing: CGFloat = 16
    static let sectionSpacing: CGFloat = 24

    static let pagePadding: CGFloat = 16
    static let surfacePadding: CGFloat = 16
    static let heroPadding: CGFloat = 20
    static let pillHorizontalPadding: CGFloat = 10
    static let pillVerticalPadding: CGFloat = 6
    static let badgeHorizontalPadding: CGFloat = 6
    static let badgeVerticalPadding: CGFloat = 3

    static let surfaceRadius: CGFloat = 18
    static let compactRadius: CGFloat = 12
    static let controlHeight: CGFloat = 42
    static let minimumTapTarget: CGFloat = 44
    static let scoreRowHeight: CGFloat = 44
    static let statusIconSize: CGFloat = 30
    static let teamMonogramSize: CGFloat = 34
    static let heroTeamMonogramSize: CGFloat = 42
    static let commentAvatarSize: CGFloat = 36
    static let matchHeaderScoreWidth: CGFloat = 38
    static let shotMarkerSize: CGFloat = 26

    static let compactStateHeight: CGFloat = 180
    static let standardStateHeight: CGFloat = 220

    static let matchHeaderAccessibilityHeightFraction: CGFloat = 0.55
    static let maximumContentWidth: CGFloat = 760
    static let bracketRoundWidth: CGFloat = 300
    static let bracketProgressionIconWidth: CGFloat = 18
    static let bracketSeedWidth: CGFloat = 44
    static let bracketScoreWidth: CGFloat = 28
    static let podRankWidth: CGFloat = 36
    static let podMetricMinimumWidth: CGFloat = 72
    static let tableRankWidth: CGFloat = 44
    static let tableSubjectWidth: CGFloat = 168
    static let tableValueWidth: CGFloat = 96
}
