//
//  NavigationTitleStyle.swift
//  Ruski Report
//

import SwiftUI

extension View {
    @ViewBuilder
    func appLargeNavigationTitle() -> some View {
        #if os(iOS)
        toolbarTitleDisplayMode(.large)
        #else
        self
        #endif
    }

    @ViewBuilder
    func appInlineNavigationTitle() -> some View {
        #if os(iOS)
        navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }
}
