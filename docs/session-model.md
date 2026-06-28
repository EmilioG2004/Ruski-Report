# Session Model

## V1 Roles

Ruski Report uses a lightweight session model for the first tournament-viewing
release.

- Guest users can view tournament, bracket, match, scorecard, and box score data.
- Authenticated users can view the same data and post match-scoped comments.
- Admin users can perform protected operational actions such as scorebook upload.

The iOS app expresses these rules as capabilities on `UserSession` rather than
checking concrete auth providers in views. This keeps the UI independent from
future GameCenter or TauID integration.

## Comment Posting

Comment posting must pass through `CommentAuthorizationPolicy` before calling a
comment write repository. Guests receive a sign-in-required result. Authenticated
and admin sessions are allowed to post comments.

Issue 24 should build the comments UI and write flow on top of this policy rather
than adding session checks directly to views.

## Admin Uploads

Backend scorebook upload routes are admin-only. `AdminScorebookController` is
protected by `AdminAuthGuard`, which requires the `x-admin-token` request header
to match the deploy-time `ADMIN_UPLOAD_TOKEN` environment variable.

Admin upload auth is intentionally separate from public account sessions. Public
viewing and match comments should not require or expose the admin upload token.

## Future Providers

`SessionIdentityProvider` reserves explicit cases for local accounts,
GameCenter, TauID, admin token auth, and unknown providers. Provider-specific
login can be added behind `SessionRepository` without changing tournament or
match view code.
