# Persistence Design

## Target Database

Ruski Report targets PostgreSQL for primary persistence. Stable app concepts
such as tournaments, teams, players, pods, matches, standings, comments, upload
reports, and active snapshot versions should be stored in relational tables.
Semi-structured scorebook artifacts such as validation details, source workbook
metadata, normalized scorecard data, game-specific event details, and ingestion
reports may use PostgreSQL `jsonb` where that keeps the model flexible without
weakening the main relationships.

## Repository Boundaries

Application services should depend on repository interfaces, not direct
database clients or SQL. The first implementation can be in-memory for tests;
the production implementation should satisfy the same contracts with
PostgreSQL.

- `TournamentSnapshotRepository` owns atomic publishing of normalized
  `TournamentSnapshot` data.
- `TournamentReadRepository` owns read paths for active tournament, tournament
  detail, match summaries, and match detail.
- `CommentRepository` owns app-created comments separately from imported
  scorebook data.
- `UploadReportRepository` preserves admin upload status, validation results,
  source workbook metadata, and publish history.
- `TransactionManager` defines the transaction boundary that a PostgreSQL
  implementation will map to a real database transaction.

## Snapshot Publishing

Publishing a tournament snapshot must be atomic. A successful publish writes the
normalized tournament, teams, pods, standings, bracket state, matches,
scorecards, events, game definition reference, validation result, and source
metadata, then marks the new snapshot version active. If any write fails, the
previous active snapshot remains visible and no partial tournament state should
be exposed to readers.

Only one active snapshot version should be visible for a given tournament
identity at a time. Older versions may be retained for diagnostics, rollback,
or audit history, but read repositories should default to the active version.

## Comments

Comments are not imported scorebook data. Snapshot publishing should not delete,
replace, or rewrite comments. Comments remain match-scoped app data and should
be associated to stable match identifiers.

## Upload Reports

Every admin scorebook upload should produce an upload report. Validation
failures should be stored without publishing a snapshot. Successful publishes
should record the published snapshot version. Publish failures should record
the validation result and failure metadata so the admin workflow can explain
what happened.

## Future PostgreSQL Shape

The initial PostgreSQL implementation should start with tables for active
snapshot versions, tournaments, teams, players, pods, matches, standings,
comments, upload reports, and stored source files. JSONB can hold normalized
scorecard rows, game events, box scores, validation issues, and source metadata
until those structures need dedicated query paths.
