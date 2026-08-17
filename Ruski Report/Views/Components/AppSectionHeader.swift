//
//  AppSectionHeader.swift
//  Ruski Report
//
//  Renders consistent section hierarchy and an optional item count without
//  owning feature data or navigation behavior.
//

import SwiftUI

struct AppSectionHeader: View {
    let title: String
    let subtitle: String?
    let count: Int?

    init(
        _ title: String,
        subtitle: String? = nil,
        count: Int? = nil
    ) {
        self.title = title
        self.subtitle = subtitle
        self.count = count
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: AppLayout.compactSpacing) {
            VStack(alignment: .leading, spacing: AppLayout.microSpacing) {
                Text(title)
                    .font(.title3.weight(.bold))

                if let subtitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Spacer(minLength: AppLayout.smallSpacing)

            if let count {
                Text("\(count)")
                    .font(.caption.weight(.bold).monospacedDigit())
                    .foregroundStyle(Color.appBrand)
                    .padding(.horizontal, AppLayout.pillHorizontalPadding)
                    .padding(.vertical, AppLayout.microSpacing)
                    .background(
                        Color.appBrand.opacity(AppVisualTokens.subtleTintOpacity)
                    )
                    .clipShape(Capsule())
                    .accessibilityLabel("\(count) items")
            }
        }
    }
}
