//
//  AccountCopy.swift
//  Ruski Report
//
//  Centralizes account and safety language independently from form layout and
//  session workflows.
//

enum AccountCopy {
    static let navigationTitle = "Account"
    static let done = "Done"
    static let cancel = "Cancel"
    static let statusSection = "Status"
    static let sessionSection = "Session"
    static let safetySection = "Safety"
    static let dangerSection = "Danger Zone"
    static let accountAction = "Account action"
    static let displayName = "Display name"
    static let password = "Password"
    static let signIn = "Sign In"
    static let create = "Create"
    static let createAccount = "Create Account"
    static let signOut = "Sign Out"
    static let blockedUsers = "Blocked Users"
    static let deleteAccount = "Delete Account"

    static let authenticationFailure = "Unable to authenticate."
    static let signOutFailure = "Unable to sign out."
    static let deletionFailure = "Unable to delete the account."
    static let deletionSuccess = "Your account and comments were deleted."
    static let deleteConfirmationTitle = "Delete Account?"
    static let deleteConfirmationMessage =
        "This permanently deletes your account and every comment you posted. " +
        "This action cannot be undone."
    static let deletionFooter =
        "Deleting your account permanently removes your account data and comments."
}
