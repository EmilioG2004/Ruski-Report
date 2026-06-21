//
//  AppNavigationController.swift
//  Ruski Report
//

import Combine
import SwiftUI

final class AppNavigationController: ObservableObject {
    @Published var path = NavigationPath()

    func showTournament(_ tournament: TournamentPreview) {
        path.append(AppRoute.tournament(id: tournament.id))
    }

    func reset() {
        path = NavigationPath()
    }
}
