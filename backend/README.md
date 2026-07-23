# Ruski Report Backend

NestJS backend for Ruski Report.

## Commands

```bash
npm install
npm run db:migrate
npm run start:dev
npm test
npm run build
```

The development server listens on `PORT` or `3000` by default.

## PostgreSQL

Runtime repositories use PostgreSQL. Start a local database with:

```bash
docker compose -f compose.postgres.yml up -d
export DATABASE_URL=postgresql://ruski:local-development-only@localhost:5432/ruski_report
npm run db:migrate
npm run start:dev
```

Migrations are explicit and versioned under `migrations/`. Run them before each
deployment; application startup does not mutate the schema. Production should
provide `DATABASE_URL` through its secret manager and enable `DATABASE_SSL` when
the database endpoint requires TLS. After compiling a production artifact, run
`npm run db:migrate:prod` before `npm start`.

PostgreSQL integration tests require a disposable database because they truncate
application tables between cases:

```bash
docker compose -f compose.postgres.yml exec postgres \
  createdb -U ruski ruski_report_test
export TEST_DATABASE_URL=postgresql://ruski:local-development-only@localhost:5432/ruski_report_test
npm run test:postgres
```

Unit tests continue to use the in-memory repository adapters directly and do
not require PostgreSQL.

Health check:

```bash
curl http://localhost:3000/api/health
```

## Account Authentication

Public accounts use a display name and password. Register with
`POST /api/auth/register`, sign in with `POST /api/auth/login`, verify a bearer
session with `GET /api/auth/session`, and revoke it with
`DELETE /api/auth/session`. Authenticated users permanently delete their current
account with `DELETE /api/auth/account`. Registration and login return a random
opaque token; clients send it as `Authorization: Bearer <token>`.

The database stores scrypt password hashes and SHA-256 token hashes, never raw
passwords or session tokens. Authenticated comment writes use the verified
session identity. The separate `x-admin-token` header remains exclusive to
scorebook administration.

Account deletion runs in a transaction and cascades to credentials, identity
mappings, every session, and authored comments. It publishes affected-match
comment refresh events only after commit. See
[`docs/session-model.md`](../docs/session-model.md#account-deletion) and
[`docs/privacy-data-handling.md`](../docs/privacy-data-handling.md) for the
client recovery and retention contract.

## Comment Moderation

Authenticated comment submissions are normalized and evaluated by the backend
before persistence. Configured prohibited phrases, excessive links, repeated
characters, repeated words, and recently duplicated comments are rejected with
stable error codes. Rejected content is never persisted or included in
moderation logs.

Moderation thresholds use the `COMMENT_*` environment variables documented in
`src/config/README.md`. Prohibited phrases come from
`config/comment-moderation-rules.json` by default; production can set
`COMMENT_MODERATION_RULES_PATH` to a mounted operator-maintained file.

## Structure

- `src/controllers`: HTTP controller boundaries.
- `src/auth`: Public account workflows, password hashing, and bearer-session guard.
- `src/services`: Application and business workflow services.
- `src/repositories`: Persistence interfaces and implementations.
- `src/database`: PostgreSQL pool, transactions, and migration runner.
- `src/domain`: Framework-free tournament and game domain contracts.
- `src/ingestion`: Scorebook upload, parsing, validation, and normalization workflows.
- `src/games`: Game plugins such as the v1 Ruski module.
- `src/config`: Environment and application configuration.
- `src/logging`: Logging abstractions and adapters.
- `src/realtime`: Socket.IO WebSocket gateway and typed live update publisher.
- `src/routes`: Route registration notes and future module routing boundaries.

## Realtime Updates

The backend exposes a Socket.IO WebSocket namespace at `/live` using the default
Socket.IO path `/socket.io`. Clients listen for `live.update` events and send
`subscribe` events for `all`, `tournament`, or `match` scopes. See
`src/realtime/README.md` for payloads and deployment notes.
