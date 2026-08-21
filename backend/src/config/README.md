# Config

Configuration belongs here. Prefer environment-driven values for deploy-time
settings such as database URL, logging level, admin auth secret, and public base
URL.

## Environment Variables

- `PORT`: HTTP port for the NestJS server. Defaults to `3000`.
- `HOST`: Address used by the NestJS listener. Defaults to `0.0.0.0`, which is
  required inside the production container. Restrict host exposure through the
  Compose port binding rather than changing the container listener.
- `CORS_ALLOWED_ORIGINS`: Comma-separated exact HTTP or HTTPS browser origins.
  Wildcards, credentials, paths, queries, and fragments are rejected. An empty
  value allows no cross-origin browser origin; native iOS requests do not
  require CORS.
- `HTTP_TRUST_PROXY_HOPS`: Number of reverse-proxy hops trusted by Express.
  Defaults to `0`; the Raspberry Pi Cloudflare deployment uses `1` because
  `cloudflared` is the only container directly in front of the API.
- `HTTP_REQUEST_BODY_LIMIT_BYTES`: Maximum parsed JSON or URL-encoded request
  body. Defaults to `8388608` bytes so the bounded advanced tournament setup
  contract fits, and cannot exceed 10 MiB.
- `HTTP_URLENCODED_PARAMETER_LIMIT`: Maximum fields accepted from a
  URL-encoded form. Defaults to `7000`, which covers the bounded advanced setup
  form, and cannot exceed `10000`.
- `SCOREBOOK_UPLOAD_LIMIT_BYTES`: Maximum multipart scorebook file size.
  Defaults to 10 MiB and cannot exceed 50 MiB.
- `ADMIN_API_TOKEN`: Preferred token for scorebook and comment-moderation
  operator routes. Clients send it in the `x-admin-token` header.
- `ADMIN_UPLOAD_TOKEN`: Legacy fallback when `ADMIN_API_TOKEN` is absent.
- `MODERATION_OPERATOR_ID`: Non-secret audit identifier recorded on moderator
  decisions. Defaults to `tournament-operator`.
- `ADMIN_WEB_ORIGIN`: Exact origin that hosts the private administrator app.
  Defaults to `http://localhost:3000`; production requires HTTPS. It is also
  the only Origin accepted for administrator state-changing requests.
- `ADMIN_AUTH_SECURE_COOKIES`: Enables the production `__Host-` administrator
  session and CSRF cookies. It defaults to enabled in production and disabled
  outside production, and cannot be disabled in production.
- `ADMIN_AUTH_SECURITY_SECRET`: Secret of at least 32 bytes used to sign
  anonymous CSRF tokens and HMAC rate-limit/audit subjects. Production must
  provide a unique value through secret storage.
- `ADMIN_AUTH_MIN_PASSWORD_LENGTH` / `ADMIN_AUTH_MAX_PASSWORD_LENGTH`:
  Administrator password byte limits. Defaults to `12` and `128`.
- `ADMIN_AUTH_SESSION_LIFETIME_SECONDS` / `ADMIN_AUTH_SESSION_IDLE_SECONDS`:
  Administrator session absolute and idle lifetimes. Defaults to `43200`
  (12 hours) and `7200` (2 hours).
- `ADMIN_AUTH_PREAUTH_CSRF_LIFETIME_SECONDS`: Anonymous sign-in, invitation,
  and recovery CSRF-token lifetime. Defaults to `900`.
- `ADMIN_AUTH_INVITATION_LIFETIME_SECONDS` / `ADMIN_AUTH_RECOVERY_LIFETIME_SECONDS`:
  Single-use invitation and recovery lifetimes. Defaults to `86400` (24 hours)
  and `1800` (30 minutes).
- `ADMIN_AUTH_RECENT_SECONDS`: Maximum authentication age for administrator
  invitation and recovery issuance. Defaults to `900`.
- `ADMIN_AUTH_SESSION_TOKEN_LENGTH`: Random opaque administrator session and
  CSRF token length in bytes. Defaults to `32` and must be between 32 and 128.
- `ADMIN_AUTH_SCRYPT_COST`, `ADMIN_AUTH_SCRYPT_BLOCK_SIZE`,
  `ADMIN_AUTH_SCRYPT_PARALLELIZATION`, `ADMIN_AUTH_SCRYPT_KEY_LENGTH`, and
  `ADMIN_AUTH_SCRYPT_SALT_LENGTH`: Administrator password hashing parameters.
  Defaults to `16384`, `8`, `1`, `64`, and `16`.
- `ADMIN_AUTH_PREAUTH_NETWORK_MAX` / `_WINDOW_SECONDS`,
  `ADMIN_AUTH_LOGIN_NETWORK_MAX` / `_WINDOW_SECONDS`,
  `ADMIN_AUTH_LOGIN_IDENTITY_NETWORK_MAX` / `_WINDOW_SECONDS`,
  `ADMIN_AUTH_TOKEN_NETWORK_MAX` / `_WINDOW_SECONDS`, and
  `ADMIN_AUTH_SENSITIVE_ADMIN_MAX` / `_WINDOW_SECONDS`: Persisted rate-window
  limits for administrator authentication, token use, and sensitive commands.
- `AUTH_MAX_DISPLAY_NAME_LENGTH`: Maximum local account display-name length.
  Defaults to `40`.
- `AUTH_MIN_PASSWORD_LENGTH` / `AUTH_MAX_PASSWORD_LENGTH`: Accepted local
  password length range. Defaults to `10` and `128`.
- `AUTH_SESSION_LIFETIME_SECONDS`: Opaque public-session lifetime. Defaults to
  `2592000` (30 days).
- `AUTH_SCRYPT_COST`, `AUTH_SCRYPT_BLOCK_SIZE`, and
  `AUTH_SCRYPT_PARALLELIZATION`: Password hashing work factors. Defaults to
  `16384`, `8`, and `1`.
- `AUTH_SCRYPT_KEY_LENGTH` / `AUTH_SCRYPT_SALT_LENGTH`: Derived-key and random
  salt lengths in bytes. Defaults to `64` and `16`.
- `AUTH_SESSION_TOKEN_LENGTH`: Random opaque-token length in bytes. Defaults to
  `32`.
- `COMMENT_MAX_BODY_LENGTH`: Maximum normalized comment length. Defaults to
  `500`.
- `COMMENT_DUPLICATE_WINDOW_SECONDS`: Time during which the same account cannot
  post an identical normalized comment to the same match. Defaults to `300`.
- `COMMENT_MAX_LINKS`: Maximum links accepted in one comment. Defaults to `2`.
- `COMMENT_MAX_REPEATED_CHARACTER_RUN`: Maximum consecutive identical
  non-whitespace characters. Defaults to `8`.
- `COMMENT_MAX_REPEATED_TOKEN_COUNT`: Maximum consecutive identical normalized
  words. Defaults to `4`.
- `COMMENT_MODERATION_RULES_PATH`: JSON file containing `blockedPhrases`.
  Defaults to `config/comment-moderation-rules.json`. Production deployment
  may mount a separately maintained rules file without rebuilding the backend.
- `COMMENT_REPORT_CONTEXT_MAX_LENGTH`: Maximum optional report context length.
  Defaults to `500` and cannot exceed the database safety limit of `2000`.
- `COMMENT_REPORT_RESOLUTION_NOTE_MAX_LENGTH`: Maximum operator resolution-note
  length. Defaults to `500` and cannot exceed `2000`.
- `COMMENT_REPORT_MAX_PER_WINDOW`: Maximum distinct reports one account may
  submit in the configured rate window. Defaults to `5`.
- `COMMENT_REPORT_WINDOW_SECONDS`: Persisted report-rate window. Defaults to
  `600`.
- `COMMENT_REPORT_QUEUE_PAGE_SIZE`: Maximum reports returned by an operator
  queue request. Defaults to `50`.
- `DATABASE_URL`: PostgreSQL connection string. Defaults to the local
  `postgres:postgres` development database when omitted.
- `DATABASE_SSL`: Set to `true` when the PostgreSQL endpoint requires TLS.
- `DATABASE_SSL_REJECT_UNAUTHORIZED`: Controls certificate verification and
  defaults to `true`. Disable only for a trusted endpoint with a self-signed
  certificate.
- `DATABASE_POOL_MAX`: Maximum pooled connections. Defaults to `10`.
- `DATABASE_CONNECTION_TIMEOUT_MS`: Connection timeout. Defaults to `5000`.
- `DATABASE_IDLE_TIMEOUT_MS`: Idle connection timeout. Defaults to `30000`.
- `DATABASE_MIGRATIONS_DIR`: Optional absolute migration directory. Defaults to
  `<working directory>/migrations`.
- `TEST_DATABASE_URL`: Disposable PostgreSQL database used by repository,
  administrator-security, setup-publication, and backfill integration tests.
- `POPULATED_MIGRATION_DATABASE_URL`: Separate disposable PostgreSQL database
  used for populated migration rehearsals. Both disposable URLs are required
  by `npm run test:postgres`.

The backend fails startup if its moderation rules file is missing, invalid, or
empty. This prevents a packaging or deployment mistake from silently disabling
the objectionable-content filter.
