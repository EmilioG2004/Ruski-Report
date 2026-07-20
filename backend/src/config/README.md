# Config

Configuration belongs here. Prefer environment-driven values for deploy-time
settings such as database URL, logging level, admin auth secret, and public base
URL.

## Environment Variables

- `PORT`: HTTP port for the NestJS server. Defaults to `3000`.
- `ADMIN_UPLOAD_TOKEN`: Required token for admin scorebook upload routes. Clients
  must send the matching value in the `x-admin-token` header.
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
