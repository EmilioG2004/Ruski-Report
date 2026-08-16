//
//  AppSheetRouter.swift
//  Ruski Report
//

import Combine
import Foundation

final class AppSheetRouter: ObservableObject {
    @Published var presentedSheet: AppSheetDestination?

    func showAccount() {
        presentedSheet = .account
    }
}

enum AppSheetDestination: Identifiable, Hashable {
    case account

    var id: String {
        switch self {
        case .account:
            "account"
        }
    }
}
