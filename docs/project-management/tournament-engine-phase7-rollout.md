# Tournament Engine Phase 7 Rollout And Rollback

This runbook governs the first production rollout of the canonical tournament
engine. It is an operator checklist, not standing authorization. Production
Raspberry Pi, PostgreSQL, Cloudflare, AWS, GitHub settings, TestFlight, and App
Store Connect remain out of scope until the owner explicitly authorizes the
specific action and maintenance window.

## Roles And Stop Conditions

Before the window, record one person for each role: decision maker, database
backup/restore operator, application deploy operator, and observer. A person may
hold multiple roles, but the decision maker must acknowledge rollback triggers.

Stop before changing production if any of these is missing:

- the exact release commit and built-artifact digest;
- a Phase 7 local summary with zero failures;
- a fresh encrypted backup and a successful restore rehearsal to an isolated
  database;
- deterministic dry-run/apply/no-op backfill evidence on that restored copy;
- deep 2026 v1/v2 semantic equivalence on the restored copy;
- enough window time to restore the database and previous application build;
- the previous application artifact and its deployment procedure;
- explicit production authorization.

During rollout, immediately stop and choose rollback if migration/backfill
reports a failure or mismatch, protected-row digests change, v1/v2 semantics
diverge, active projection is missing/partial, API/database health fails,
realtime carries the wrong projection version, privacy canaries appear in logs,
or the old released iOS client cannot read the legacy endpoints.

## Pre-Window Rehearsal

1. Restore the fresh backup into a newly created, isolated database. Do not
   reuse either local qualification database.
2. Record PostgreSQL version, schema migration identifiers, row-count/digest
   evidence for legacy snapshots, match identities, comments, reports, blocks,
   accounts, and moderation data. Record digests and counts only.
3. Build the release candidate once. Use that exact artifact for rehearsal and
   production; record its digest.
4. Point the candidate only at the restored database. Run migrations.
5. Run the legacy backfill without `--apply` twice. Both outputs must be
   deterministic and status `dry_run` with no blocking issues.
6. Run with `--apply` once, verify deep semantic equivalence and protected-row
   digests, then run it again. The second apply must be a deterministic no-op.
7. Exercise full synthetic setup→champion lifecycle and workbook
   beginning/middle/correction/end/missing-sheet/no-op paths. Verify public
   projection activation and version-pinned realtime after every committed
   command.
8. Destroy or securely retain the restored copy under the existing data policy.
   Never publish its connection string or contents as evidence.

The backfill CLI is dry-run by default:

```bash
DATABASE_URL="$RESTORED_DATABASE_URL" npm run db:backfill:legacy -- \
  --tournament-id "$LEGACY_TOURNAMENT_ID"
```

`--apply` is permitted only on the isolated rehearsal copy until the production
window is explicitly authorized.

## Production Window

1. Announce the maintenance window and prevent administrator setup, workbook,
   progression, roster, and legacy workbook writes. Guest reads may remain only
   if the deployment method guarantees they use the unchanged old schema.
2. Confirm API/database health and capture bounded pre-change counts/digests.
3. Create the final encrypted backup. Verify completion and record its digest,
   retention location identifier, restore owner, and expiration without
   recording credentials or filesystem paths.
4. Stop the application process before migrations if concurrent old-code writes
   cannot be excluded.
5. Run additive migrations with the release artifact. On any error, do not run
   backfill; proceed to database restore.
6. Run the production legacy backfill dry run. Compare its safe summary to the
   rehearsed plan. A mismatch stops rollout.
7. Run backfill apply once. Require status success, canonical public projection
   activation, protected legacy-row digest stability, and deep v1/v2 semantic
   equivalence. Run it a second time and require no-op.
8. Start the exact release application artifact. Do not delete the previous
   artifact.
9. Verify health, then run the read-only v1/v2/realtime hook. Confirm the old
   workbook endpoint remains registered, 2026 remains readable, 2026 is not
   incorrectly listed as active in v2, and all currently active tournaments
   appear on v2 discovery.
10. Run bounded administrator canaries through the approved flows. Export the
    corresponding application-log window and pass the privacy audit. Delete
    temporary canary files securely after evidence is recorded.
11. Observe database errors, API error rate, realtime reconnects, projection
    versions, and old-client reads for the agreed canary period. Do not inspect
    or retain private payloads.
12. The decision maker records proceed or rollback. Only then end maintenance.

Do not use `scripts/release-qualification/production-write.mjs` or directly
republish the 2026 workbook. The retired workflow does not migrate canonical
state and can overwrite the evidence boundary.

## Rollback Before Backfill Commit

If migration fails before backfill commits:

1. Keep the application stopped and preserve failure metadata without raw
   errors, paths, URLs, or data.
2. Replace the failed database with a new restore from the final pre-window
   backup. Do not attempt destructive down migrations or ad-hoc row deletion.
3. Start the previous application artifact against the restored database.
4. Verify health, the legacy active/detail/match/comment endpoints, old-client
   reads, and realtime handshake.
5. Record rollback result and keep the canonical release blocked.

## Rollback After Backfill Or Application Start

Canonical migrations are additive, but restoration is still the authoritative
rollback for the first migration. If any post-commit trigger fires:

1. Re-enter maintenance and stop all administrator writes and the new
   application.
2. Preserve safe counts/digests and the failed projection version. Do not edit
   projection pointers by hand or delete canonical/legacy rows.
3. Restore the final pre-window backup to a newly created database and verify
   its digest. Switch only through the established database configuration
   procedure; never paste a connection string into logs or evidence.
4. Deploy the previous application artifact and verify database/API health,
   legacy 2026 tournament/matches/comments, community reads, and realtime.
5. Run the privacy log audit for the rollback window.
6. Keep the maintenance window open until the decision maker confirms old iOS
   client compatibility and data-preservation counts.
7. Retain the failed database only under the approved incident/data policy; do
   not modify it for a retry. Rehearse the fix on a new restore.

An immutable old canonical projection can be reactivated by the repository and
is covered by PostgreSQL tests, but Phase 7 exposes no approved production
operator endpoint for that action. Therefore do not use ad-hoc SQL as a faster
rollback. Use full database restore for the first rollout unless a separately
reviewed, audited operator tool is shipped and qualified.

## Evidence To Record

Record only:

- release commit and artifact digest;
- PostgreSQL and migration versions;
- backup digest/retention identifier and restore rehearsal status;
- sanitized backfill run status, issue codes, counts, and determinism/no-op
  status;
- protected-row digest comparison result;
- v1/v2 equivalence rule results and projection version;
- health/read/realtime/log-audit result counts;
- simulator/device `.xcresult` identifiers;
- timestamps, operator roles, decision, and any linked GitHub blocker.

Never record the database URL, admin credential, session/CSRF material,
workbook or community content, log lines, private paths, or screenshots that
contain private data.
