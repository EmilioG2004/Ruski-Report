# Tournament Engine Release Qualification

This is the Phase 7 gate for the canonical tournament engine. It does not
authorize a production change. Record observed results in
[release qualification evidence](release-qualification-evidence.md) and follow
the [rollout and rollback runbook](tournament-engine-phase7-rollout.md) only
after the owner explicitly authorizes production access.

## Evidence Rules

- A gate is `passed` only when evidence from the current release candidate
  exists. Earlier releases are historical context, not transferable evidence.
- `blocked` means the gate was not executed in its required environment. A
  blocked gate cannot be treated as a pass because local tests cover a similar
  path.
- Never put database URLs, credentials, session or CSRF values, workbook
  contents, community content, request bodies, production paths, or raw logs in
  evidence. Store only counts, stable gate codes, tool versions, and artifact
  digests.
- The old `production-write` command is retired. It republished the 2026 legacy
  workbook and cannot qualify canonical migration or a new tournament.

## Local Two-Database Gate

Create two fresh, separate PostgreSQL databases. The clean database exercises
the current schema and lifecycle. The populated database exercises migrations
and backfill without sharing state with the clean suite.

```bash
export TEST_DATABASE_URL='postgresql://localhost/ruski_qualification_clean'
export POPULATED_MIGRATION_DATABASE_URL='postgresql://localhost/ruski_qualification_populated'
node scripts/release-qualification/run.mjs local
```

The harness rejects a missing URL, a non-PostgreSQL URL, a PostgreSQL system
database, or two identical URLs before running commands. The operator remains
responsible for proving both targets are disposable and contain no production
secrets.

The ordered manifest runs these groups:

| Gate | Executable coverage |
| --- | --- |
| Backend lint/build/unit | TypeScript lint, production build, and every non-integration Jest suite. |
| Lifecycle contracts | Setup, workbook generation and parsing, beginning/middle/correction/end/no-op planning, canonical event adaptation, statistics, standings, seeds, mirrored bracket, progression, public projection, v2 reads, and realtime publication. |
| Projection/realtime transaction | The production dependency graph must inject projection refresh/listener dependencies, the listener must emit version-pinned tournament and changed-match events, and the PostgreSQL projection suite must retain an old active pointer on activation failure. |
| PostgreSQL integration | Migrations on clean and populated databases; setup, workbook reconciliation, statistics, progression, projection, backfill, authentication, authorization, CSRF, rate-limit, and audit persistence suites. |
| Release tools | Two-database guard, deterministic evidence, v1/v2 comparison, canary log audit, retired write path, and realtime observer tests. |
| Client/configuration | iOS Release configuration and public policy-site validation. |

The JSON result is deterministic and sanitized. It records the candidate commit
SHA, a dirty-worktree boolean, and Node/Git versions, but never changed paths.
A dirty checkout is an explicit failed gate. Local command passes are listed
alongside production restore, migration, equivalence, log, simulator, and
device gates as `blocked`. Consequently, a successful clean local run still has
`releaseReady: false` until the external evidence is recorded.

## Restored Production-Shaped Rehearsal

Use a newly restored, isolated copy of the production database; never point the
local harness at production. Before touching the copy, record the encrypted
backup digest and restore verification result without recording its path or
contents.

On the restored copy:

1. Run migrations, the legacy 2026 backfill dry run, and the dry run again.
   Both plans must be deterministic and must not change legacy snapshots,
   match identities, comments, reports, blocks, accounts, or moderation rows.
2. Apply the backfill once. It must commit canonical rows and one coherent
   public projection atomically. Apply it a second time; it must be a no-op.
3. Require semantic v1/v2 equivalence for tournament identity, roster history,
   match identities and results, standings/statistics, seeds, bracket
   progression, and public projection pointers. Counts alone are insufficient.
4. Exercise failure injection before commit, during backfill apply, during
   projection materialization, and before active-pointer change. Each failure
   must retain the previous readable state and permit a clean retry.
5. Start the release candidate against the restored copy through an isolated
   HTTPS endpoint. Run the read hook below, then exercise the complete
   setup→pod play→correction→seeding→bracket→champion lifecycle on a synthetic
   tournament. Verify beginning, middle, correction, end, missing-sheet, and
   idempotent workbook paths.

Do not claim this gate from clean synthetic databases alone. The production-
shaped restore is required to reveal legacy data and migration compatibility
failures.

## V1/V2 Read And Equivalence Hook

Against an authorized isolated candidate or the production read-only window:

```bash
RUSKI_QUALIFICATION_API_URL='https://candidate.example/api' \
RUSKI_QUALIFICATION_PUBLIC_URL='https://candidate.example' \
node scripts/release-qualification/run.mjs production-read
```

The hook verifies API/database health, supported games, the legacy tournament,
legacy match detail/comments, v2 active and historical discovery, a version-
pinned v2 tournament/match read, common material v1/v2 semantics, and initial
plus reconnected realtime handshakes. It supports 2026 appearing in v2 history
instead of active discovery. The home contract separately requires all active
v2 tournaments; two simultaneous active tournaments are valid.

The hook's comparator is a transport gate for shared public fields. The
restored-database backfill verifier remains authoritative for deep standings,
statistics, roster-history, audit, and bracket equivalence.

## Privacy-Safe Production Log Gate

Create unique synthetic canaries of at least eight characters and use them only
in the approved qualification requests. Store them in a temporary file outside
Git. Export a bounded application-log window that covers the requests, then run:

```bash
node scripts/release-qualification/run.mjs logs \
  /path/to/application.log /path/to/canaries
```

The audit scans every structured and unstructured line. It rejects a canary,
credential pattern, private-key marker, sensitive assignment, or recursively
sensitive field such as request/comment content, workbook bytes, administrator
resolution notes, report context, session/CSRF material, and authorization.
It requires at least one complete structured application entry and reports only
line numbers and rule names. A canary match is a release blocker; do not copy
the matching log line into evidence.

Bounded operational metadata remains allowed: operation/result codes, entity
identifiers, projection versions, counts, workbook identifiers, and artifact
digests. Raw exception messages, stacks, filesystem paths, attacker-controlled
request IDs, request bodies, and workbook contents are prohibited.

## Exact iOS Release Matrix

Run unit and UI suites serially on both representative devices using the
release endpoint:

- Compact: iPhone 17e, portrait, light and dark appearance.
- Large: iPhone 17 Pro Max, portrait, light and dark appearance.
- Physical: one registered iPhone using the Release configuration.

Each simulator must show all-active-tournament home discovery, no-active and
two-active states, scheduled, live, final, forfeited, cancelled,
score-unavailable, bye, correction, champion, long-name/dense-content,
authenticated/community, offline, delayed failure, retry, and realtime
recovery states. Repeat the core home→tournament→match flow at an accessibility
Dynamic Type size and inspect VoiceOver labels. Retain `.xcresult` summaries and
privacy-reviewed screenshots; never retain tokens or private community text.

Production outage or packet-loss changes require a separate maintenance-window
authorization. Without production or simulator/device access, those gates must
remain blocked and cannot be claimed from code review.

## Approval Gate

Release approval requires all of the following from the same release candidate:

- local two-database summary has zero failures;
- restored production-shaped migration, deterministic backfill, no-op retry,
  protected-row digest, deep semantic equivalence, and restore rehearsal pass;
- production read-only v1/v2/realtime hook passes after authorized rollout;
- bounded production log window passes with canaries absent;
- compact, large, and physical iPhone matrices pass;
- the backup/restore owner, rollback trigger, maintenance window, and decision
  maker are recorded.

Any failure or blocked item stops the release. Do not modify the database or
begin rollout merely because the local summary completed.
