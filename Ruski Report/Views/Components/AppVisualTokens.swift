//
//  AppVisualTokens.swift
//  Ruski Report
//
//  Defines non-dimensional visual constants shared by surfaces and controls.
//  Keeping these tokens semantic prevents feature views from encoding styling.
//

import SwiftUI

enum AppVisualTokens {
    static let subtleTintOpacity = 0.12
    static let selectedBadgeOpacity = 0.18
    static let statusPillOnBrandOpacity = 0.16
    static let secondaryOnBrandOpacity = 0.82
    static let strongOnBrandOpacity = 0.88
    static let dividerOnBrandOpacity = 0.20
    static let heroShadowOpacity = 0.20
    static let elevatedShadowOpacity = 0.08
    static let gradientMiddleOpacity = 0.82
    static let gradientEndOpacity = 0.88
    static let monogramGradientEndOpacity = 0.72
    static let monogramTextScale = 0.32
    static let compactTextScale = 0.82
    static let overlineTracking: CGFloat = 1.2

    static let elevatedShadowRadius: CGFloat = 14
    static let elevatedShadowY: CGFloat = 6
    static let heroShadowRadius: CGFloat = 18
    static let heroShadowY: CGFloat = 8

    static let selectionAnimation = Animation.snappy(duration: 0.22)
}
