//
//  AppSurface.swift
//  Ruski Report
//

import SwiftUI

struct AppSurface<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(AppLayout.surfacePadding)
        .background(Color.appSecondaryGroupedBackground)
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
            .stroke(Color.appSeparator, lineWidth: 0.5)
        }
    }
}
