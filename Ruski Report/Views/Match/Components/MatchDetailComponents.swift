//
//  MatchDetailComponents.swift
//  Ruski Report
//
//  Contains the small structural surfaces shared by multiple game panels.
//

import SwiftUI

struct MatchSectionView<Content: View>: View {
    let title: String
    let systemImage: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.compactSpacing) {
            HStack(spacing: AppLayout.smallSpacing) {
                Image(systemName: systemImage)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Color.appBrand)
                    .frame(
                        width: AppLayout.statusIconSize,
                        height: AppLayout.statusIconSize
                    )
                    .background(
                        Color.appBrand.opacity(AppVisualTokens.subtleTintOpacity)
                    )
                    .clipShape(Circle())

                Text(title)
                    .font(.title3.weight(.bold))
            }

            AppSurface {
                content
            }
        }
    }
}

struct EmptyMatchSectionView: View {
    let title: String
    let systemImage: String

    var body: some View {
        Label(title, systemImage: systemImage)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 12)
    }
}
