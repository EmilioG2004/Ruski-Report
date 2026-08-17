//
//  AppSurface.swift
//  Ruski Report
//
//  Provides the shared container strategy for cards, elevated scores, and
//  inset data without exposing concrete colors to feature views.
//

import SwiftUI

enum AppSurfaceStyle {
    case card
    case elevated
    case inset
}

struct AppSurface<Content: View>: View {
    let style: AppSurfaceStyle
    @ViewBuilder let content: Content

    init(
        style: AppSurfaceStyle = .card,
        @ViewBuilder content: () -> Content
    ) {
        self.style = style
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.contentSpacing) {
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(AppLayout.surfacePadding)
        .background(surfaceColor)
        .clipShape(
            RoundedRectangle(
                cornerRadius: AppLayout.surfaceRadius,
                style: .continuous
            )
        )
        .overlay {
            RoundedRectangle(
                cornerRadius: AppLayout.surfaceRadius,
                style: .continuous
            )
            .stroke(Color.appSeparator, lineWidth: AppLayout.hairlineWidth)
        }
        .shadow(
            color: style == .elevated
                ? Color.black.opacity(AppVisualTokens.elevatedShadowOpacity)
                : .clear,
            radius: AppVisualTokens.elevatedShadowRadius,
            x: 0,
            y: AppVisualTokens.elevatedShadowY
        )
    }

    private var surfaceColor: Color {
        switch style {
        case .card, .elevated:
            .appSecondaryGroupedBackground
        case .inset:
            .appInsetBackground
        }
    }
}
