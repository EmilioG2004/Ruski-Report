# Privacy Data Handling

This document is the implementation source of truth for Ruski Report's current
account and comment data handling. Publishing the complete user-facing privacy
policy, support contact, and community standards is tracked by GitHub issue 43.

## Account And Session Data

The local account system stores:

- A case-normalized display name and an opaque account identifier.
- A versioned, salted scrypt password hash. The raw password is not stored.
- SHA-256 hashes of opaque session tokens and their expiration and revocation
  timestamps. Raw tokens are stored only in the iOS Keychain.
- External-provider identifiers if Game Center or TauID adapters are introduced.

This data exists to authenticate a public account and attribute comments. It is
not sold or used for advertising.

## Comments

Comments store their body, creation time, match identifier, author display name,
and author account identifier. They are public within the associated match and
exist so authenticated users can participate in match discussion.

Before storage, submissions pass through automated content and spam checks.
Rejected comment text is not stored. Moderation logs contain the decision code,
match identifier, character count, and a non-content rule identifier; they do
not contain the rejected body, display name, password, or session token.
Allowed comments store a SHA-256 fingerprint of their normalized comparison
form so recent duplicates can be detected without storing a second readable
copy of the body.

Tournament rosters, scores, and player statistics are imported from scorebooks.
They are tournament records rather than public-account profile data and are not
created or controlled by the local account system.

## Account Deletion And Retention

An authenticated user can choose **Delete Account** in the iOS account screen.
After destructive confirmation, the app calls `DELETE /api/auth/account`.
PostgreSQL permanently deletes the account and cascades the same transaction to:

- Local password credentials.
- External identity mappings.
- All active, expired, and revoked sessions.
- Every comment authored by the account.

The current application does not create a deletion audit record or retain any
of those account-linked values for legal or security purposes. A second request
using the former token is unauthorized because its server session was deleted.

No production backup or log-retention exception is implemented in this
pre-deployment repository. If deployment adds backups or identity-bearing
operational logs, the public policy must define their retention period and the
deletion process before App Store submission. Issue 43 owns that publication
check.

## Failure Handling

The account and its related database records are deleted atomically. A database
failure rolls back the whole deletion. Realtime comment-refresh notifications
occur only after commit and contain match identifiers, not deleted account
identifiers.

If iOS cannot confirm whether a request succeeded, it does not continue to
present an authenticated session. It clears the local token and returns to
guest mode, where tournament viewing remains available.
