//
//  HomeScreenHeader.swift
//  Ruski Report
//
//  Establishes the score feed's identity and purpose independently from its
//  loading state or tournament content.
//

import SwiftUI

struct HomeScreenHeader: View {
    var body: some View {
        VStack(alignment: .leading, spacing: AppLayout.smallSpacing) {
            Text(HomeCopy.eyebrow)
                .font(.caption.weight(.black))
                .tracking(AppVisualTokens.overlineTracking)
                .foregroundStyle(Color.appBrandSecondary)

            Text(HomeCopy.title)
                .font(.largeTitle.weight(.black))
                .accessibilityIdentifier("home.title")

            Text(HomeCopy.subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
