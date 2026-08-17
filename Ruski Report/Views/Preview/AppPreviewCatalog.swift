//
//  AppPreviewCatalog.swift
//  Ruski Report
//
//  Collects deterministic whole-app previews for the UI states most likely to
//  regress as the score feed and game center gain new information.
//

import SwiftUI

#Preview("Standard Score Feed") {
    AppRootView(services: .preview(scenario: .standard))
}

#Preview("Empty Tournament") {
    AppRootView(services: .preview(scenario: .empty))
}

#Preview("Unavailable Tournament") {
    AppRootView(services: .preview(scenario: .unavailable))
}

#Preview("Long Content · Dark") {
    AppRootView(services: .preview(scenario: .longContent))
        .preferredColorScheme(.dark)
}

#Preview("Authenticated") {
    AppRootView(services: .preview(scenario: .authenticated))
}
