//
//  StatusPill.swift
//  Ruski Report
//

import SwiftUI

struct StatusPill: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color.accentColor.opacity(0.14))
            .foregroundStyle(Color.accentColor)
            .clipShape(Capsule())
    }
}
