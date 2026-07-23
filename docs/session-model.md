# Session Model

## Roles And Capabilities

Ruski Report represents authorization as capabilities on `UserSession` so views
do not depend on an identity provider.

- Guests can view tournament, bracket, match, scorecard, box score, and comment
  data without an account.
- Authenticated public accounts can view the same data and post match comments.
- Admin credentials protect operational scorebook uploads and are not public
  account sessions.

## Local Accounts

The v1 production account provider uses a unique, case-normalized display name
and password. The backend exposes these routes under `/api`:

- `POST /auth/register` creates an account and its first session atomically.
- `POST /auth/login` verifies local credentials and creates a new session.
- `GET /auth/session` verifies the current bearer session.
- `DELETE /auth/session` revokes the current bearer session.
- `DELETE /auth/account` permanently deletes the authenticated account.

Passwords are stored as versioned scrypt hashes with random salts. Login and
registration return a cryptographically random opaque token; PostgreSQL stores
only its SHA-256 hash. Sessions have a configured expiration and can be revoked.
The iOS app stores the raw token as a generic-password Keychain item and restores
the session by asking the backend to verify it on launch.

## Account Deletion

`DELETE /auth/account` is protected by the same bearer-session guard as the
other authenticated routes. The endpoint always derives the account identifier
from the verified principal; clients cannot select a different account.

Deletion removes the `user_accounts` row in a PostgreSQL transaction. Foreign
keys cascade that deletion to local credentials, external identity mappings,
every active or expired session, and every comment authored by the account. The
backend does not retain an account tombstone, password hash, session hash,
display name, or authored comment. Existing moderation reports are anonymized:
the reporter identifier and optional context are erased while minimal workflow
state may remain for operational audit. Tournament player data comes from
uploaded scorebooks and is independent of public app accounts, so it is outside
this account-deletion cascade.

After the transaction commits, the backend publishes a comment update for each
affected match. Realtime publication is intentionally outside the transaction:
a disconnected Socket.IO client cannot roll back or partially restore deleted
account data.

The iOS account screen explains that deletion is permanent and requires a
second destructive confirmation. After a confirmed server response, the app
clears the Keychain token and switches to guest mode. If the response is
ambiguous, the app verifies the session:

- A verified profile means deletion failed and the authenticated session can be
  retained.
- An unauthorized or unreachable verification endpoint means the client cannot
  safely prove the account still exists, so it clears local credentials and
  returns to guest mode.
- A Keychain cleanup failure is shown explicitly while the in-memory session
  remains in guest mode.

The implementation-aligned privacy notes in
[privacy-data-handling.md](privacy-data-handling.md) record the current
retention behavior. Publishing the complete public privacy and support surfaces
remains tracked separately by GitHub issue 43.

## Comment Posting

`POST /matches/:matchId/comments` requires `Authorization: Bearer <token>`. Its
request body contains only `body`; the backend derives `author.kind`,
`author.displayName`, and `author.userId` from the verified session principal.
Client-supplied author fields have no effect. Guest comment reads remain public.

The iOS `CommentAuthorizationPolicy` still prevents guest posting attempts in
the UI, but it is a convenience rather than the security boundary.

Before persistence, the backend normalizes comment text and applies the
configured moderation and spam rules. Rejections use stable detail codes while
the iOS composer maps moderation failures to controlled local messages. Raw
rejected text and private rule contents are not written to moderation logs.
Recently repeated comments are rejected atomically per account and match.

`POST /comments/:commentId/reports` also requires the public bearer session.
The server derives the reporter identity from that session and never accepts a
reporter ID from the request body. Duplicate reports from one account are
idempotent, and the persisted per-account rate window is enforced
transactionally.

The operator report queue remains separate from public accounts. Requests to
`GET /admin/comment-reports` and `PATCH /admin/comment-reports/:reportId` use
the configured `x-admin-token`; the configured non-secret operator identifier
is written to reviewed and resolved audit records.

See [community-standards.md](community-standards.md) for prohibited content and
the current enforcement scope.

## Admin Uploads

`AdminScorebookController` remains protected by `AdminAuthGuard` and the
`x-admin-token` header configured by `ADMIN_API_TOKEN`, with
`ADMIN_UPLOAD_TOKEN` retained as a legacy fallback. Public bearer tokens cannot
authorize admin uploads or moderation, and the iOS account flow never stores
or sends the admin token.

## Game Center And TauID

Future identity providers should be adapters at the authentication boundary:

1. Verify the provider assertion with Game Center or TauID.
2. Resolve its stable provider subject through `external_identities`.
3. Create or load the associated `user_accounts` row.
4. Issue the same opaque `auth_sessions` token used by local accounts.

Both provider identifiers are already valid account providers in PostgreSQL and
map to explicit `SessionIdentityProvider` cases on iOS. Provider adapters should
not change comment authorization, session storage, or tournament views.
