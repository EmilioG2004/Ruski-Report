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

PostgreSQL integration tests require two disposable databases. Repository and
administrator/setup/backfill cases truncate application tables, while the
populated-migration database is reserved for upgrade rehearsals:

```bash
docker compose -f compose.postgres.yml exec postgres \
  createdb -U ruski ruski_report_test
docker compose -f compose.postgres.yml exec postgres \
  createdb -U ruski ruski_report_migration_test
export TEST_DATABASE_URL=postgresql://ruski:local-development-only@localhost:5432/ruski_report_test
export POPULATED_MIGRATION_DATABASE_URL=postgresql://ruski:local-development-only@localhost:5432/ruski_report_migration_test
npm run test:postgres
```

Unit tests continue to use the in-memory repository adapters directly and do
not require PostgreSQL.

## Private Administrator Application

The server-rendered administrator application is available at
`/api/admin/app`. It uses separate administrator identities, opaque cookie
sessions, strict same-origin CSRF protection, persisted rate limits, and
immutable security and tournament-command audit records. The legacy
`x-admin-token` remains limited to scorebook upload and moderation routes; it
does not authorize the new tournament setup APIs.

Production must provide an exact HTTPS `ADMIN_WEB_ORIGIN`, secure cookies, and
a unique `ADMIN_AUTH_SECURITY_SECRET` of at least 32 bytes. Apply migrations
before creating the first administrator. The bootstrap command writes the
single-use credential only to a newly created mode-0600 file outside the
repository; it never prints the raw token:

```bash
npm run db:admin-credential -- bootstrap \
  --login-name tournament-admin \
  --display-name "Tournament Administrator" \
  --token-output /absolute/private/path/ruski-admin-bootstrap.json
```

Use the non-secret acceptance URL and token from that file to complete setup in
the browser. After an administrator exists, create additional invitations from
the authenticated administrator API. A local recovery credential uses the
same protected-file workflow:

```bash
npm run db:admin-credential -- recover \
  --administrator-id 00000000-0000-0000-0000-000000000000 \
  --token-output /absolute/private/path/ruski-admin-recovery.json
```

Delete the credential file after the token is consumed or expires. Production
artifacts without a `.git` checkout also require
`--protected-output-root /absolute/private/directory`. The Raspberry Pi
runbook documents the one-shot container invocation and protected bind mount.

Authenticated JSON setup routes live under `/api/admin/tournaments`. Setup
publication accepts only the expected row version, server-issued preview
digest, and visibility; the database transaction regenerates the schedule and
atomically locks setup, creates scheduled matches, and writes its engine audit.
The built-in 32-team preset generates 48 pod-play matches. Published setups
can generate and download canonical workbooks from
`/api/admin/tournaments/:tournamentId/workbooks`; the private web application
exposes the same workflow. Imports first create a 24-hour preview, compare
stable per-sheet identities and semantic fingerprints, and require an explicit
accepted/skipped partition before applying. Missing sheets are non-destructive,
identical sheets are audited no-ops, and uploaded workbook bytes are never
stored.

Tournament-engine migrations `0007` through `0013` are additive. A previous
application binary can run while their new tables and guards remain in place;
do not drop administrator audit, tournament-engine history, generated workbook
artifacts, reconciliation records, progression history, or public projections
to roll back an application release. A database rollback uses a verified
pre-migration backup and the documented restore rehearsal in
`deploy/raspberry-pi/operations`, never a destructive down script.

The 2026 migration command is dry-run by default and is the only supported
legacy mutator:

```bash
npm run db:backfill:legacy -- --tournament-id <legacy-public-id>
# Apply only under the Phase 7 maintenance and rollback procedure:
npm run db:backfill:legacy -- --tournament-id <legacy-public-id> --apply
```

Completed canonical tournaments are intentionally absent from active discovery
and remain readable through `/api/v2/tournaments/history` and pinned v2 detail
routes. Follow the Phase 7 rollout runbook before applying the 2026 backfill;
never infer production authorization from these commands.

Health check:

```bash
curl http://localhost:3000/api/health
```

## Raspberry Pi Deployment

The production ARM64 image, Compose stack, and operator instructions live in
[`../deploy/raspberry-pi/`](../deploy/raspberry-pi/). The local
`compose.postgres.yml` file is development-only: it publishes PostgreSQL and
uses a non-production password, so it must not be deployed to the Pi.

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
scorebook and moderation operator workflows.

Account deletion runs in a transaction and cascades to credentials, identity
mappings, every session, authored comments, and block relationships in either
direction. It publishes affected-match comment refresh events only after commit.
See
[`docs/session-model.md`](../docs/session-model.md#account-deletion) and
[`docs/privacy-data-handling.md`](../docs/privacy-data-handling.md) for the
client recovery and retention contract.

## User Blocking

Signed-in public accounts can manage a private block list:

- `GET /api/account/blocks`
- `PUT /api/account/blocks/:userId`
- `DELETE /api/account/blocks/:userId`

Block and unblock are idempotent, self-blocking is rejected, and the list is
ordered by newest block followed by account identifier. Blocking does not
report, moderate, or delete the other account's comments.

`GET /api/matches/:matchId/comments` remains public. With no `Authorization`
header it returns the guest feed. With a valid public bearer session it omits
comments authored by accounts that viewer blocked. A malformed, expired, or
revoked credential supplied by the client returns `401`; it is never silently
downgraded to a guest read.

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

Signed-in users submit reports with `POST /comments/:commentId/reports`.
Reports are stored independently of scorebook snapshots, deduplicated per
account and comment, and protected by a persisted rate window.

Operator endpoints use the separate `x-admin-token` credential:

- `GET /admin/comment-reports?status=open`
- `PATCH /admin/comment-reports/:reportId`

Supported actions are `mark_reviewed`, `dismiss`, and `remove_comment`.
Removing a comment updates its report records atomically and publishes a
`comments.updated` event after commit. See the
[comment moderation runbook](../docs/comment-moderation-runbook.md).

## Structure

- `src/controllers`: HTTP controller boundaries.
- `src/auth`: Public account workflows, password hashing, and bearer-session guard.
- `src/user-blocking`: Private block-list workflows and authenticated API routes.
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
