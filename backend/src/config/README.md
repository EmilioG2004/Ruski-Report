# Config

Configuration belongs here. Prefer environment-driven values for deploy-time
settings such as database URL, logging level, admin auth secret, and public base
URL.

## Environment Variables

- `PORT`: HTTP port for the NestJS server. Defaults to `3000`.
- `ADMIN_UPLOAD_TOKEN`: Required token for admin scorebook upload routes. Clients
  must send the matching value in the `x-admin-token` header.
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
- `TEST_DATABASE_URL`: Disposable PostgreSQL database used only by the explicit
  integration-test command.

The backend fails startup if its moderation rules file is missing, invalid, or
empty. This prevents a packaging or deployment mistake from silently disabling
the objectionable-content filter.
