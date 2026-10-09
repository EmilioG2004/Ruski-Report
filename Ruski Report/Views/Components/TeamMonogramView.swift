//
//  TeamMonogramView.swift
//  Ruski Report
//
//  Supplies a deterministic team identity placeholder until official artwork
//  becomes part of the tournament model.
//

import SwiftUI

struct TeamMonogramView: View {
    let name: String
    var size = AppLayout.teamMonogramSize
    var onBrand = false

    var body: some View {
        Text(initials)
            .font(
                .system(
                    size: size * AppVisualTokens.monogramTextScale,
                    weight: .bold,
                    design: .rounded
                )
            )
            .foregroundStyle(onBrand ? Color.appBrand : Color.appOnBrand)
            .frame(width: size, height: size)
            .background(monogramBackground)
            .clipShape(Circle())
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var monogramBackground: some View {
        if onBrand {
            Color.appOnBrand
        } else {
            LinearGradient(
                colors: [
                    Color.appBrand,
                    Color.appBrand.opacity(
                        AppVisualTokens.monogramGradientEndOpacity
                    )
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
    }

    private var initials: String {
        let words = name
            .split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .prefix(2)
        let value = words.compactMap(\.first).map(String.init).joined()
        return value.isEmpty ? "?" : value.uppercased()
    }
}
