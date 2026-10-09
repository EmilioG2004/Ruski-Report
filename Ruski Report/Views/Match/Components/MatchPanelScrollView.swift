//
//  MatchPanelScrollView.swift
//  Ruski Report
//
//  Gives non-chat game destinations consistent independent scrolling, width,
//  and page insets beneath the persistent context shell.
//

import SwiftUI

struct MatchPanelScrollView<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        ScrollView {
            content
                .padding(AppLayout.pagePadding)
                .frame(
                    maxWidth: AppLayout.maximumContentWidth,
                    alignment: .leading
                )
                .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
    }
}
