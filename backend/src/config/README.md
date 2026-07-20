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

## Application Defaults

- `comments.config.ts`: Match comment limits, including `maxBodyLength`.
- `auth.config.ts`: Public account validation, password hashing, and session
  lifetime settings.
