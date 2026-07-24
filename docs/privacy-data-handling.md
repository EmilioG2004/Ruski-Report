# Privacy Data Handling

This document is the implementation source of truth for Ruski Report's current
account and comment data handling. The canonical user-facing policy source is
[`docs/public/privacy/index.html`](public/privacy/index.html) and is prepared
for publication at:

https://emiliog2004.github.io/Ruski-Report/privacy/

Emilio Garcia is the policy owner. Ruski Report is an independent project with
no school or educational-institution affiliation. Support requests go to
`ruskisupport@gmail.com` and are normally answered within three business days.

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

Comments are intentionally retained indefinitely as part of the associated
match discussion. Moderator removal sets the comment's deletion timestamp so it
no longer appears in public feeds; its soft-deleted database record supports the
associated moderation audit. Account deletion is the exception: the account
foreign key cascades and physically deletes every comment authored by that
account.

Before storage, submissions pass through automated content and spam checks.
Rejected comment text is not stored. Moderation logs contain the decision code,
match identifier, character count, and a non-content rule identifier; they do
not contain the rejected body, display name, password, or session token.
Allowed comments store a SHA-256 fingerprint of their normalized comparison
form so recent duplicates can be detected without storing a second readable
copy of the body.

## Comment Reports

Comment reports store the reported comment identifier, match identifier,
reporter account identifier, selected reason, optional reporter context,
workflow state, timestamps, resolution, and configured moderator audit
identifier. Report context and reported comment text are never written to
application logs.

Reports remain separate from imported tournament snapshots and therefore are
not removed by scorebook publication. Public comment reads never expose report
records or reporter identities.

When a reporting account is deleted, its report identity is anonymized and its
optional context is erased in the same account-deletion transaction. The
minimal reason, state, timestamps, and resolution may remain as an operational
audit record. If a reported author's account is deleted, the associated
comment is deleted and the report retains only its stable comment reference,
not a copied comment body.

## User Blocks

A block stores only the blocking account identifier, blocked account
identifier, and creation timestamp. The relationship is private to the blocking
account. Public APIs do not disclose who blocked an account, and blocking does
not notify the blocked account.

Authenticated comment reads use the relationship to omit comments authored by
blocked accounts for that viewer. Guest reads have no viewer identity and
therefore return the unfiltered public comment feed. A block is not a report,
does not copy comment text, does not delete content, and does not enter the
operator moderation queue.

Block and unblock logs contain only decision flags such as whether a relation
already existed. They do not contain either account identifier, a display name,
comment text, password, or session token.

Tournament rosters, scores, and player statistics are imported from scorebooks.
They are tournament records rather than public-account profile data and are not
created or controlled by the local account system.

Normalized tournament records are retained permanently as the official Ruski
archive. This persistence decision does not add historical-tournament browsing
to the current app; archive discovery and past-season UI remain future work.
The uploaded workbook is processed from its request buffer. PostgreSQL retains
source metadata, checksum, validation results, and publication history rather
than the original workbook bytes as a database file.

## Account Deletion And Retention

An authenticated user can choose **Delete Account** in the iOS account screen.
After destructive confirmation, the app calls `DELETE /api/auth/account`.
PostgreSQL permanently deletes the account and cascades the same transaction to:

- Local password credentials.
- External identity mappings.
- All active, expired, and revoked sessions.
- Every comment authored by the account.
- Every block relation where the account is either participant.

The current application does not create an account-deletion tombstone or retain
those account-linked authentication, comment, or block values. This deletion
exception takes precedence over the normal indefinite comment retention.
Existing moderation reports may retain their reason, state, timestamps, and
resolution after the reporter identity and optional context are erased. A
second request using the former token is unauthorized because its server
session was deleted.

No production backup or persistent access-log facility is implemented in this
pre-deployment repository. The public policy limits production logs and rotating
backups, if enabled, to 30 days unless a security investigation or law requires
longer retention. Raspberry Pi deployment must configure and verify that limit
before App Store submission. The release checklist records this as an explicit
deployment gate rather than claiming that an undeployed service already
enforces it.

## Age, Analytics, And Service Providers

People under 13 may not create an account or post comments. The service does not
include third-party analytics, advertising SDKs, or cross-app tracking, and
does not sell personal information.

GitHub Pages processes normal web requests for the public policy site, Google
processes email sent to the Gmail support address, and Apple distributes the
iOS app. A production tunnel, reverse proxy, or other network provider has not
yet been selected. If one is added during Raspberry Pi deployment, its data
handling must be reviewed against the public policy before it receives
production traffic.

## Failure Handling

The account and its related database records are deleted atomically. A database
failure rolls back the whole deletion. Realtime comment-refresh notifications
occur only after commit and contain match identifiers, not deleted account
identifiers.

If iOS cannot confirm whether a request succeeded, it does not continue to
present an authenticated session. It clears the local token and returns to
guest mode, where tournament viewing remains available.
