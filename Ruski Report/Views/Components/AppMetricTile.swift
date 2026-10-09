//
//  AppMetricTile.swift
//  Ruski Report
//
//  Presents a label, value, and semantic symbol in the shared dashboard style.
//

import SwiftUI

struct AppMetricTile: View {
    let title: String
    let value: String
    let systemImage: String

    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.compactSpacing) {
            Image(systemName: systemImage)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(Color.appBrand)
                .frame(
                    width: AppLayout.statusIconSize,
                    height: AppLayout.statusIconSize
                )
                .background(
                    Color.appBrand.opacity(AppVisualTokens.subtleTintOpacity)
                )
                .clipShape(Circle())

            Text(value)
                .font(.title3.weight(.bold).monospacedDigit())
                .fixedSize(horizontal: false, vertical: true)

            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(AppLayout.contentSpacing)
        .background(Color.appInsetBackground)
        .clipShape(
            RoundedRectangle(
                cornerRadius: AppLayout.compactRadius,
                style: .continuous
            )
        )
    }
}
