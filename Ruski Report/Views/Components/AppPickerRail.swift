//
//  AppPickerRail.swift
//  Ruski Report
//
//  Implements a reusable, horizontally extensible feature selector. Options
//  supply presentation metadata while the parent remains the state owner.
//

import SwiftUI

struct AppPickerRail<Option: Hashable & Identifiable>: View {
    let options: [Option]
    @Binding var selection: Option
    let title: (Option) -> String
    let systemImage: (Option) -> String
    let badge: (Option) -> String?
    let accessibilityIdentifier: (Option) -> String

    init(
        options: [Option],
        selection: Binding<Option>,
        title: @escaping (Option) -> String,
        systemImage: @escaping (Option) -> String,
        badge: @escaping (Option) -> String? = { _ in nil },
        accessibilityIdentifier: @escaping (Option) -> String
    ) {
        self.options = options
        _selection = selection
        self.title = title
        self.systemImage = systemImage
        self.badge = badge
        self.accessibilityIdentifier = accessibilityIdentifier
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: AppLayout.smallSpacing) {
                ForEach(options) { option in
                    AppPickerRailButton(
                        title: title(option),
                        systemImage: systemImage(option),
                        badge: badge(option),
                        isSelected: selection == option,
                        accessibilityIdentifier: accessibilityIdentifier(option)
                    ) {
                        select(option)
                    }
                }
            }
            .padding(.vertical, AppLayout.microSpacing)
        }
    }

    private func select(_ option: Option) {
        withAnimation(AppVisualTokens.selectionAnimation) {
            selection = option
        }
    }
}

private struct AppPickerRailButton: View {
    let title: String
    let systemImage: String
    let badge: String?
    let isSelected: Bool
    let accessibilityIdentifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: AppLayout.smallSpacing) {
                Image(systemName: systemImage)
                    .font(.caption.weight(.bold))

                Text(title)
                    .font(.subheadline.weight(.semibold))

                if let badge {
                    Text(badge)
                        .font(.caption2.weight(.bold).monospacedDigit())
                        .padding(.horizontal, AppLayout.badgeHorizontalPadding)
                        .padding(.vertical, AppLayout.badgeVerticalPadding)
                        .background(badgeBackground)
                        .clipShape(Capsule())
                }
            }
            .lineLimit(1)
            .padding(.horizontal, AppLayout.contentSpacing)
            .frame(minHeight: AppLayout.controlHeight)
            .foregroundStyle(isSelected ? Color.appOnBrand : Color.primary)
            .background(isSelected ? Color.appBrand : Color.appInsetBackground)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(accessibilityIdentifier)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var badgeBackground: Color {
        isSelected
            ? Color.white.opacity(AppVisualTokens.selectedBadgeOpacity)
            : Color.appBrand.opacity(AppVisualTokens.subtleTintOpacity)
    }
}
