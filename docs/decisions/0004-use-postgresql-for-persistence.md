# ADR 0004: Use PostgreSQL for Persistence

## Status

Accepted

## Context

Ruski Report needs to store normalized tournament data after the backend ingests
the official Excel scorebook. The backend also needs persistence for comments,
users or guest sessions, admin upload reports, match state, standings, bracket
state, and future in-app scoring workflows.

Most of this data is structured and relational:

- A tournament has teams, pods, matches, standings, and bracket rounds.
- A match has teams, players, scorecard rows, events, comments, and status.
- A player appears across matches and contributes to aggregate stats.
- A comment belongs to a match and an author.

Some data is semi-structured:

- Normalized scorebook snapshots.
- Ingestion validation reports.
- Game-specific scorecard metadata.
- Ruski-specific event/stat details.

The persistence layer needs to support both shapes without pushing the entire
system toward either rigid over-modeling or unstructured document storage.

## Decision

Use PostgreSQL as the primary database for Ruski Report.

Core app data will be stored in relational tables. Semi-structured ingestion and
game-specific data may use PostgreSQL `jsonb` columns where that preserves
flexibility without weakening the main domain model.

Repositories will hide database details from controllers, services, ingestion
code, and game plugins. The rest of the backend should depend on repository
interfaces rather than direct SQL or ORM calls.

## Rationale

PostgreSQL fits the data model because Ruski Report is fundamentally a
tournament application with relationships between tournaments, teams, players,
matches, events, comments, and users.

Comments may contain free-form text, but comment records are still structured
data. They need stable fields such as `id`, `matchId`, `authorId`, `body`,
`createdAt`, and moderation or deletion metadata. A relational database handles
that cleanly.

PostgreSQL also gives the project room for semi-structured scorebook data
through `jsonb`. This is useful for preserving normalized tournament snapshots,
ingestion reports, and game-specific metadata without forcing every imported
detail into a permanent table before the ingestion model has matured.

Choosing PostgreSQL also supports the project's resume-quality goal. It creates
space to demonstrate migrations, schema design, transactional snapshot
publishing, repository boundaries, relational queries, JSONB usage, and
production-style deployment.

## Alternatives Considered

### SQLite

SQLite is simple, reliable, and easy to run on a Raspberry Pi. It would be a
good early prototype choice because it requires no separate database server.

SQLite was not selected as the primary persistence layer because Ruski Report is
expected to grow into comments, authenticated users, admin workflows, realtime
updates, and eventually in-app scoring. PostgreSQL better matches those
concurrency and schema-growth needs.

### MongoDB

MongoDB would make it easy to store whole tournament snapshots as documents.

MongoDB was not selected because most of the application data is relational.
Players, teams, matches, comments, standings, and stats have stable
relationships that are easier to enforce and query in PostgreSQL. PostgreSQL's
`jsonb` support covers the semi-structured parts without giving up relational
modeling.

### Flat JSON Files

Flat JSON files would be simple for storing normalized tournament snapshots.

This was rejected because comments, users, concurrent writes, migrations,
atomic publishing, and queryable match/player data would become fragile quickly.
JSON files may still be useful for fixtures, exports, or debug snapshots, but
not as the primary database.

### Hosted Document or Realtime Database

Firebase, Firestore, Supabase Realtime, and similar tools could reduce some
operational work.

These were not selected as the primary persistence decision because Ruski
Report already has a custom NestJS backend for scorebook ingestion, validation,
normalization, and realtime events. PostgreSQL keeps persistence inside the
backend architecture and avoids making the core data model depend on a hosted
document database.

## Consequences

The backend foundation should include PostgreSQL configuration, migration
tooling, and repository abstractions.

The first persistence implementation should support atomic tournament snapshot
publishing. A failed scorebook ingestion must not partially replace visible
tournament data.

The data model should use relational tables for stable app concepts and `jsonb`
for semi-structured scorebook snapshots, ingestion reports, and game-specific
metadata where appropriate.

Local development and deployment documentation must account for running
PostgreSQL alongside the NestJS backend. The Raspberry Pi deployment plan should
include database backups, restore steps, and service restart behavior.

SQLite may still be used for throwaway experiments or isolated tests if useful,
but production and primary local development should target PostgreSQL.

