//
//  AccountFormMode.swift
//  Ruski Report
//
//  Defines presentation metadata for extensible guest account actions.
//

enum AccountFormMode: String, CaseIterable, Identifiable {
    case signIn
    case createAccount

    var id: String { rawValue }

    var label: String {
        switch self {
        case .signIn: AccountCopy.signIn
        case .createAccount: AccountCopy.create
        }
    }

    var sectionTitle: String {
        switch self {
        case .signIn: AccountCopy.signIn
        case .createAccount: AccountCopy.createAccount
        }
    }

    var buttonLabel: String { sectionTitle }

    var systemImage: String {
        switch self {
        case .signIn: "person.crop.circle.badge.checkmark"
        case .createAccount: "person.crop.circle.badge.plus"
        }
    }
}
