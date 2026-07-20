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

Passwords are stored as versioned scrypt hashes with random salts. Login and
registration return a cryptographically random opaque token; PostgreSQL stores
only its SHA-256 hash. Sessions have a configured expiration and can be revoked.
The iOS app stores the raw token as a generic-password Keychain item and restores
the session by asking the backend to verify it on launch.

## Comment Posting

`POST /matches/:matchId/comments` requires `Authorization: Bearer <token>`. Its
request body contains only `body`; the backend derives `author.kind`,
`author.displayName`, and `author.userId` from the verified session principal.
Client-supplied author fields have no effect. Guest comment reads remain public.

The iOS `CommentAuthorizationPolicy` still prevents guest posting attempts in
the UI, but it is a convenience rather than the security boundary.

## Admin Uploads

`AdminScorebookController` remains protected by `AdminAuthGuard` and the
`x-admin-token` header configured by `ADMIN_UPLOAD_TOKEN`. Public bearer tokens
cannot authorize admin uploads, and the iOS account flow never stores or sends
the admin token.

## Game Center And TauID

Future identity providers should be adapters at the authentication boundary:

1. Verify the provider assertion with Game Center or TauID.
2. Resolve its stable provider subject through `external_identities`.
3. Create or load the associated `user_accounts` row.
4. Issue the same opaque `auth_sessions` token used by local accounts.

Both provider identifiers are already valid account providers in PostgreSQL and
map to explicit `SessionIdentityProvider` cases on iOS. Provider adapters should
not change comment authorization, session storage, or tournament views.
