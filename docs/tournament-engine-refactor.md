# Tournament Engine And Ingestion Refactor

## Status

Planning baseline accepted on August 20, 2026. This document defines the target
architecture and implementation gates. It does not authorize production
changes or replace GitHub Issues as the work-status source of truth.

The Phase 0 architecture, rules, fixture requirements, and migration invariants
were approved on August 20, 2026, and Phase 1 implementation was authorized.
Home discovery was amended to show every active public tournament, and playoff
placement does not impose a same-pod separation constraint.

## Summary

Refactor Ruski Report from a complete-workbook snapshot importer into a
database-backed tournament lifecycle. Administrators will use a private,
remotely accessible web application to create tournaments, register teams and
players, assign pods and initial pod seeds, publish the setup, generate a
canonical Excel workbook, reconcile scorecard updates, finalize pod standings,
override calculated playoff seeds when necessary, and publish a
single-elimination bracket.

The backend becomes authoritative for stable identity, match events, scores,
statistics, standings, effective seeds, and bracket progression. Excel remains
a familiar scorekeeping import/export surface and future in-app scoring writes
to the same canonical event model. The public iOS read contract should remain
compatible where practical while gaining explicit lifecycle, projection,
identity, and score-availability guarantees.

## Goals

- Support multiple tournaments in one calendar year.
- Support a configurable pod-play-to-single-elimination engine.
- Ship a built-in main tournament configuration of 32 teams, eight four-team
  pods, two players per team, two qualifiers per pod, and a 16-team bracket.
- Design tournament configurations so saved administrator-defined presets can
  be added later without redesigning tournaments already created from a
  configuration.
- Give remote administrators individual authenticated access to a private web
  application hosted by the NestJS backend.
- Generate stable pod-play matches and Excel scorecards from published setup.
- Accept idempotent cumulative-workbook imports and audited corrections.
- Calculate match, player, team, pod, and tournament statistics from canonical
  scoring events.
- Calculate pod standings and playoff seeds using the official rules, while
  permitting audited administrator seed overrides.
- Generate and advance the playoff bracket from backend state without requiring
  the legacy visual bracket worksheet.
- Preserve the completed 2026 tournament, its public display, match identities,
  comments, and legacy full-workbook endpoint.
- Prevent the prior class of display defects caused by unstable identity,
  mixed snapshot versions, missing scores, and bracket-only results.
- Establish the event and concurrency boundaries required for a future in-app
  live scoring platform.

## Non-Goals

- Implementing saved preset creation or preset-management UI in the initial
  refactor.
- Supporting Swiss, double-elimination, round-robin finals, arbitrary stage
  graphs, or arbitrary game rules.
- Implementing the in-app scoring interface in this refactor.
- Implementing uncontrolled two-way cell synchronization between a live Excel
  editor and the future in-app scorer.
- Recreating the legacy visual Excel bracket sheet.
- Deleting or rewriting legacy snapshot history.

## Accepted Product Decisions

- Administrators use a private web application hosted by the backend and
  reachable remotely.
- Administrators have individual operator identities; a shared server token is
  not stored in browser code.
- Tournament identity is independent from calendar year.
- The main tournament always has 32 teams, eight pods, four teams per pod, two
  players per team, and two playoff qualifiers per pod.
- A generalized engine is desirable within the bounded format of pod play
  followed by single elimination.
- Team names cannot change after setup publication.
- Players may be replaced; history must retain who participated in each match.
- Teams cannot move pods after setup publication.
- Initial seed means position within a pod.
- Operators normally use generated scorecards or copy the blank scorecard.
- Match dates and times may be unknown.
- Matches may be cancelled or forfeited. Forfeits count as a loss.
- The same teams may meet more than once in different tournament stages.
- Missing workbook sheets do not delete imported matches.
- Corrections create audited revisions. Final and playoff corrections require
  preview and confirmation, and dependent playoff results are protected.
- A forfeit contributes one win or loss, zero cup differential, and no shooting
  percentage denominator.
- A postponed matchup remains required. A cancelled matchup is permanently
  resolved and excluded from required-match completion and standings inputs.
- Pod standings order by win/loss record, then cup differential, then team
  shooting percentage.
- Anything that is not a make is a miss for shooting-percentage purposes; Di
  and Tri remain special miss classifications.
- The top two teams from every pod qualify. Qualifiers are globally ranked by
  record, cup differential, and team shooting percentage.
- Administrators may override calculated playoff seeds.
- Playoff placement uses the standard mirrored seeded-bracket algorithm. Teams
  from the same pod may meet again whenever their effective seeds place them
  together, and byes go to the highest effective seeds.
- A pod can be finalized when every required match is completed or otherwise
  resolved under the accepted forfeit/cancellation policy. Pod play is complete
  when all pods are finalized.
- PostgreSQL owns statistics. Excel formulas remain temporarily for operator
  familiarity and reconciliation, not canonical state.
- The 2026 tournament is a completed legacy season.
- The legacy full-workbook endpoint remains available during migration.
- Generalized v1 configurations require equal pod sizes while retaining an
  explicit `podSizes` array for future balanced-uneven support.
- Home displays every active public tournament. The normal case may be one,
  but zero or multiple concurrent active tournaments are valid.
- Initial administrator invitations and recovery use expiring single-use
  tokens shared out of band. Another administrator or the local bootstrap path
  performs recovery; mandatory second factor is deferred while schema support
  remains possible.
- Bracket publication produces a newly generated cumulative canonical workbook.
- Workbook apply may accept an explicit subset of valid proposed sheets, but
  applies that subset atomically and audits skipped sheets.
- Canonical scorecards assign copied blanks explicitly first, with exact stable
  identity matching as the only fallback. Participants freeze at the first
  scoring revision. Guy, Di, Tri, or splash-out may decorate one miss attempt;
  incompatible simultaneous classifications are rejected and Vom remains a
  separate non-shot occurrence.

## Current Architecture And Gap

The current endpoint accepts one complete `.xlsx` workbook, parses every
recognized sheet, validates fixed 32-team standings and a fixed 16-team bracket,
infers team identity through aggregate statistics and fuzzy roster/name
matching, normalizes the entire workbook into a `TournamentSnapshot`, writes an
immutable PostgreSQL snapshot version, and atomically activates it.

This implementation has valuable behavior to preserve:

- Parse, validation, publication, and realtime notification boundaries.
- Transaction-scoped advisory locking and atomic active-version switching.
- Immutable historical snapshots and upload reports.
- Stable comment storage outside imported snapshot versions.
- Ruski scorecard parsing, turn ordering, event labels, cup scoring, and box
  score behavior.
- Public HTTP reads with compact realtime refresh notifications.

It does not model season setup, scheduled games, partial-season identity,
backend-calculated standings, seeding finalization, generated brackets, stable
identity independent from names, or match-level reconciliation. It was
qualified against a completed workbook rather than the full season lifecycle.

## Target Authority Boundaries

### Administrator Application

Owns intentional operational commands:

- Tournament creation and configuration.
- Team, initial roster, pod, and pod-seed setup.
- Player replacement.
- Setup publication and locking.
- Workbook generation and import preview/confirmation.
- Match correction, cancellation, forfeit, and resolution workflows.
- Pod finalization.
- Seed override and bracket publication.
- Operator audit access.

### PostgreSQL

Owns canonical state:

- Tournament identity, format configuration, lifecycle, and visibility.
- Stable team, player/roster, pod, and match identities.
- Match revisions and canonical scoring events.
- Scores and statistics projections.
- Standings calculations and finalizations.
- Calculated and effective playoff seeds.
- Bracket topology, slots, results, and advancement.
- Workbook imports, sheet fingerprints, decisions, and audit records.
- Public projection versions.

### Excel

Acts as an adapter:

- Receives generated tournament and match metadata.
- Records shot attempts and special result classifications in the familiar
  scorecard layout.
- Provides existing formulas and summary views as non-authoritative
  reconciliation aids during transition.
- Does not own stable identity, standings, seeds, or bracket topology.

### Future In-App Scoring

Acts as a second adapter into the same match command/event boundary. It must not
introduce another score calculation or statistics implementation.

## Configurable Tournament Engine

### Supported Format

The initial generic engine supports:

1. One pod stage.
2. Round-robin scheduling within each pod.
3. A configurable number of qualifiers per pod.
4. Global qualifier ranking.
5. One single-elimination bracket with optional byes.

Tournament configuration must be copied onto the tournament when it is created.
Future saved presets may create configurations, but editing or deleting a
preset must never mutate an existing tournament.

Illustrative configuration:

```json
{
  "formatVersion": 1,
  "formatType": "pod_and_single_elimination",
  "teamCount": 32,
  "podCount": 8,
  "podSizes": [4, 4, 4, 4, 4, 4, 4, 4],
  "gamesPerPair": 1,
  "qualifiersPerPod": 2,
  "bracketSize": 16,
  "allowByes": false,
  "standingsRules": [
    "record",
    "cupDifferential",
    "teamShootingPercentage",
    "administratorResolution"
  ]
}
```

The built-in main preset supplies this configuration. The initial admin site
may expose the main preset plus direct advanced configuration without yet
supporting named, reusable custom preset records.

### Validation

- The number of team assignments must equal `teamCount`.
- Pod sizes must sum to `teamCount`.
- Every team belongs to exactly one pod.
- Initial pod seeds are unique and contiguous within a pod.
- Qualifiers per pod cannot exceed the smallest pod size.
- The qualifier count must fit the configured bracket.
- If the qualifier count is below the bracket size, byes must be permitted.
- The bracket size must support deterministic single-elimination placement.
- The main preset rejects any deviation from its fixed 32/8/4/2/16 contract.

### Schedule Generation

For one game per pair, a pod of `n` teams produces `n(n-1)/2` matches. The main
preset therefore produces six matches per pod and 48 pod matches. Match IDs are
generated before scorecards and never depend on worksheet titles.

Matches begin as scheduled with nullable date/time. The public app renders an
unknown schedule explicitly rather than inventing a date or treating the match
as live.

### Qualifying And Bracket Size

The qualifier count is the sum of qualifiers selected from all pods. The
configured bracket must be large enough for those qualifiers. A generalized
configuration may use the next supported power-of-two bracket and assign byes
to unfilled positions. The main preset has 16 qualifiers and no byes.

Bracket placement uses the standard mirrored seeded arrangement. The highest
effective seeds receive any byes, and no same-pod separation adjustment is
applied.

## Tournament Lifecycle

Use an explicit lifecycle rather than deriving tournament status solely from
whether a live game exists:

1. `draft_setup`
2. `setup_published`
3. `pod_play`
4. `seeding_review`
5. `playoffs`
6. `completed`
7. `archived`

Transitions occur through audited commands. Public visibility remains separate
from lifecycle. Active discovery returns all public tournaments in an active
lifecycle, so multiple tournaments may coexist in one year without overloading
calendar year as identity.

Setup publication locks team names, pod assignments, initial pod seeds, and the
format configuration. Player replacement remains available through a separate
audited command.

## Canonical Identity And Roster History

- Tournament IDs are immutable UUIDs; year is indexed but not unique.
- Tournament team IDs are immutable UUIDs scoped to a tournament.
- Match IDs are immutable UUIDs created by schedule or bracket generation.
- Worksheet names, team names, player names, and calendar year are display or
  lookup values, not primary identity.
- A player entry used in one tournament is not automatically merged with a
  same-named person in another tournament. A future public-account/person link
  may be optional.
- Roster membership has an effective boundary. Replacing a player closes the
  old membership and opens the new one.
- A match revision stores the participant/player identities that actually
  played, so historical match detail remains correct after replacement.

## Canonical Match Event Model

The canonical stream contains typed match events. The primary scoring event is
one shot attempt:

- Stable event ID and match ID.
- Revision and sequence/turn identity.
- Team and player identity.
- Outcome of make or miss.
- Zero or more shot classifications such as Guy, Di, Tri, or splash-out.
- Cup/score effect and phase metadata when required.
- Source adapter and source reference.
- Creation, correction, and operator audit metadata.

Each attempt contributes exactly once to attempts, makes, and misses. Special
miss types decorate the attempt and do not add a second attempt. Team shooting
percentage is `makes / (makes + misses)` over the applicable scope.

Non-shot occurrences such as a Vom, forfeit, cancellation, phase transition,
or operator correction are separate typed match events or commands. They may
affect eligibility, match state, or future turns without incorrectly adding a
shot attempt.

The current Ruski scorecard parser should adapt rows into these canonical
attempt commands. The future in-app scorer will send the same commands one at a
time.

### Writer Coordination

A match has one active scoring mode or writer lease at a time:

- `excel_import`
- `in_app_live`
- `operator_correction`

An app-scored match can be exported into Excel. An Excel-scored match can be
imported as a revision. The system does not merge simultaneous peer edits at
the cell level.

## Workbook Contract

### Generated Workbook

After setup publication, the backend generates the canonical tournament
workbook. For the main preset it should generate all 48 pod scorecards at once,
plus a blank scorecard and setup/control information. When the bracket is
published, the backend generates or appends the playoff scorecards.

The legacy visual bracket worksheet is discontinued for the new engine.
Optional standings/statistics worksheets may remain for operator familiarity,
but the backend owns their canonical values.

### Compatibility

- Keep the visible scorecard structure relatively similar to the original.
- Preserve existing formulas initially where they do not conflict with hidden
  metadata or generated layout.
- Add a workbook schema/version identifier.
- Add a setup/control sheet.
- Generated game sheets receive stable metadata from the database.
- A copied blank sheet may be reconciled only when it maps unambiguously to one
  unresolved match. Ambiguity is a validation error, never a fuzzy guess.

### Hidden Game Metadata

- Workbook schema version.
- Tournament ID.
- Match ID.
- Tournament stage.
- Pod ID or bracket-match ID.
- Team IDs for both sides.
- Generated revision/version.

### Import Semantics

1. Upload the cumulative workbook.
2. Parse and validate workbook version and tournament identity.
3. Fingerprint every recognized game sheet.
4. Compare sheet fingerprints with prior import records.
5. Ignore unchanged sheets.
6. Produce proposed revisions for new or changed sheets.
7. Never delete a match because a sheet is missing.
8. Present warnings, corrections, and dependent-result impact for preview.
9. Apply the accepted batch transactionally.
10. Recalculate affected match, statistics, standings, seed, and bracket
    projections.
11. Atomically activate one coherent public projection and publish compact
    realtime notifications.

An identical workbook reimport is an idempotent no-op with an audit result.

## Match Resolution And Corrections

### Status

Canonical match status supports at least:

- `scheduled`
- `in_progress`
- `final`
- `forfeited`
- `cancelled`

Score availability is separate:

- `not_started`
- `partial`
- `complete`
- `unrecorded`
- `not_applicable`

### Corrections

- A correction creates a new match revision and preserves the prior revision.
- Comments stay attached to the stable match identity.
- Worksheet rename has no identity effect.
- Missing sheets have no destructive effect.
- Final-result changes require an administrator preview and confirmation.
- An upstream playoff winner cannot change after a dependent match begins
  without an explicit cascade/rollback preview and confirmation.
- Public projections activate only after every affected derived record is
  consistent.

## Statistics And Standings

The backend derives:

- Match score and winner.
- Player and team makes, misses, attempts, and shooting percentage.
- Special Ruski classifications.
- Cup differential.
- Regular-season and playoff splits.
- Pod record and rank.
- Global qualifier rank.

Pod standings order by:

1. Win/loss record.
2. Cup differential.
3. Team shooting percentage.
4. Explicit administrator resolution if still tied.

Forfeits count as losses, contribute zero cup differential, and contribute no
shooting-percentage denominator.

Incomplete games do not contribute a final result and prevent required-match
finalization. A cancelled game is permanently excluded; a postponed game
remains required.

## Pod Finalization, Seeds, And Bracket

- A pod is eligible for finalization when all required matches are final,
  forfeited, or resolved under the accepted cancellation policy.
- Finalization records the calculation input and result as an immutable audit
  artifact.
- The top configured number of teams qualify from each pod.
- Qualifiers are globally ranked by record, cup differential, and team shooting
  percentage.
- Store both calculated seed and effective seed.
- An override records administrator, reason, previous seed, new seed, and time.
- Public APIs display the effective official seed.
- When all pods are finalized, the tournament enters `seeding_review`.
- Bracket preview resolves placement, overrides, and byes.
- Bracket publication creates persistent match and slot identities and moves the
  tournament to `playoffs`.
- Final playoff results advance winners through backend-owned bracket topology.

## Private Administrator Application

### Authentication And Authorization

- Use separate administrator identities and sessions rather than public account
  sessions or a shared browser token.
- Store versioned password hashes and hashed opaque sessions using the existing
  security principles.
- Use secure, HTTP-only, same-site cookies for the browser application.
- Protect state-changing requests against CSRF.
- Rate-limit authentication and sensitive operator actions.
- Bootstrap the first administrator through an explicit local/production
  operator command or secret-mediated process.
- Invite additional administrators with expiring, single-use invitations.
- Audit successful and rejected privileged actions without logging secrets or
  workbook content.
- Cloudflare may provide an additional access boundary, but backend
  authorization remains mandatory.

### Initial Screens

- Sign in and invitation acceptance.
- Tournament list with lifecycle and visibility state.
- Create tournament and choose the built-in main preset or advanced format.
- Team, player, pod, and initial-seed setup.
- Setup validation, schedule preview, publish, and workbook download.
- Workbook import preview, warnings, corrections, and publish result.
- Roster replacement.
- Match cancellation, forfeit, and correction.
- Pod completion and finalization.
- Seed review and override.
- Bracket preview and publication.
- Audit history.

The initial implementation should favor a focused operational interface over a
general content-management framework.

## Database Evolution

Use additive migrations. The existing immutable snapshot tables remain the
legacy archive and may continue to serve public projections during transition.

Candidate new or extended persistence concepts include:

- Administrator accounts, sessions, invitations, and audit events.
- Tournament lifecycle, visibility, feature selection, and copied format
  configuration.
- Stable tournament-team identities.
- Player/roster membership history.
- Stable pod definitions and locked assignments.
- Generated match identities with stage and schedule metadata.
- Match revisions and revision-scoped scoring events.
- Active match revision pointers or equivalent atomic selection.
- Workbook import batches and per-sheet fingerprints.
- Standings calculation/finalization records.
- Calculated seeds, effective seeds, and override audit.
- Bracket rounds, slots, source relationships, and advancement.
- Public projection versions.

Current `teams`, `players`, `pods`, `standings`, and `matches` are
snapshot-versioned read records. Do not silently reinterpret them as canonical
mutable write records. Introduce explicit canonical tables or a clearly staged
migration, then project into the existing read shape until the public API is
deliberately revised.

### Transaction Boundaries

- Setup publication locks configuration, teams, pods, and generated schedule in
  one transaction.
- Workbook import applies accepted revisions and derived changes in one
  transaction or records a failed batch without changing public state.
- Pod finalization records inputs, standings, and status atomically.
- Bracket publication records effective seeds, topology, matches, and lifecycle
  atomically.
- Public projection activation occurs only after every dependent record is
  complete.

## Public API And Application Contract

### Multiple Tournaments

Calendar year is not a unique tournament selector. Public discovery must
support multiple tournaments. Home returns every tournament whose visibility is
public and whose lifecycle is `setup_published`, `pod_play`, `seeding_review`,
or `playoffs`. Draft, completed, and archived tournaments are excluded from the
active Home collection. Calendar year remains display/filter data rather than
identity.

### Version Coherence

- Every tournament and match payload includes or can be associated with one
  public projection version.
- Tournament detail, match detail, standings, statistics, and bracket records
  must not mix versions.
- Realtime events identify the affected tournament/match and projection
  version, then clients refresh authoritative HTTP resources.

### Self-Contained Match Display

Match detail includes current display-ready team identity and the historical
players who participated. The iOS match screen must not depend on team/player
names captured in a previous tournament navigation route.

### Required Display States

- Tournament: draft/unpublished administration, setup published, pod play,
  seeding review, playoffs, completed, archived.
- Match: scheduled with unknown time, scheduled with time, live, final,
  forfeited, cancelled, and final with unavailable scorecard.
- Score: not started, partial, complete, unrecorded, and not applicable.
- Standings: zero-game rows, active calculations, finalized pod, unresolved tie,
  and administrator resolution.
- Bracket: team, winner source, bye, TBD, in progress, completed, and corrected.
- Roster: current player names in team surfaces and historical participants in
  completed matches.
- Discovery: zero, one, or multiple active public tournaments, including
  multiple tournaments in one year.

### Compatibility Strategy

- Prefer additive response fields during transition.
- Preserve current public endpoints until the updated iOS client is qualified.
- Keep legacy and canonical projection paths independently testable.
- Use contract tests to compare the 2026 legacy response with its migrated
  canonical projection for materially equivalent public information.

## Legacy 2026 Migration

- Keep the current active and historical snapshot records unchanged.
- Mark 2026 as completed legacy data.
- Preserve existing match identities, comments, reports, and moderation state.
- Existing legacy identity rows are immutable. The backfill may add only the
  deterministic compatibility `match_identities` required for bracket
  structures that had no historical match identity; those additions must not
  alter legacy public reads and must be audited separately from the preserved
  rows.
- Backfill canonical tournament, team, roster, match, result, standing, seed,
  and bracket identities from the active snapshot through an idempotent
  migration command or controlled migration step.
- Do not require the 2026 workbook to satisfy the new setup/control-sheet
  contract.
- Preserve the current full-workbook endpoint as an explicitly legacy import
  path during rollout.
- Compare migrated public projections with the qualified production response.
- Rehearse rollback through the documented backup/restore process before any
  production migration.

## Delivery Plan And Gates

### Phase 0: Contract And Fixture Baseline

- Resolve all blocking policy decisions.
- Record format configuration and lifecycle contracts.
- Capture sanitized fixtures for empty setup, partial pod play, live/final
  updates, correction, replacement, forfeit, cancellation, completed pods,
  seed override, byes, playoffs, and champion.
- Record 2026 golden public responses without copying private content into logs.

Gate: architecture, rules, fixtures, and migration invariants are approved.

### Phase 1: Canonical Domain And Persistence

- Add stable domain types and additive migrations.
- Implement repositories and transaction boundaries.
- Backfill/rehearsal tooling for 2026.
- Implement pure format validation and round-robin schedule generation.

Gate: unit and PostgreSQL integration coverage passes; legacy reads are
unchanged.

### Phase 2: Administrator Identity And Setup

- Add administrator accounts, invitations, sessions, guards, CSRF, rate limits,
  and audit.
- Add the private web shell and tournament setup workflow.
- Publish setup and generate scheduled matches.

Gate: unauthorized access fails; setup is atomic, immutable where required,
and fully audited.

### Phase 3: Workbook Generation And Reconciliation

- Generate canonical workbooks and stable game metadata.
- Parse new/corrected sheets into match revisions.
- Add fingerprinting, preview, idempotency, non-destructive omission, and audit.
- Preserve the legacy importer separately.

Gate: beginning-, middle-, correction-, and end-of-season fixture imports pass;
identical reimport is a no-op.

### Phase 4: Canonical Scoring And Statistics

- Adapt current Ruski rows/events into canonical attempts.
- Calculate match, player, team, stage, and tournament statistics.
- Reconcile existing formulas as warnings.
- Enforce scoring writer coordination.

Gate: fixture parity and special-miss rules pass without double counting.

### Phase 5: Standings, Finalization, Seeds, And Bracket

- Calculate standings and unresolved ties.
- Implement forfeit/cancellation policy.
- Finalize pods and preserve calculation inputs.
- Calculate global qualifier seeds and audited overrides.
- Generate brackets, byes, matches, and advancement.

Gate: deterministic simulations cover main and generalized configurations,
corrections, overrides, byes, and downstream dependency protection.

### Phase 6: Public Projection And iOS

- Materialize coherent public projection versions.
- Extend public discovery, tournament, match, standings, statistics, bracket,
  and realtime contracts.
- Update iOS DTOs, mappers, repositories, controllers, and views.
- Remove reliance on stale route-cached participant names.

Gate: backend contracts and compact/large iPhone state matrices pass.

### Phase 7: Legacy Migration And Release Qualification

- Rehearse and apply the 2026 backfill without mutating legacy history.
- Compare public responses.
- Exercise the full lifecycle from setup to champion.
- Run security, migration-integrity, workbook, public API, iOS, realtime,
  privacy-log, backup, and rollback qualification.

Gate: explicit release decision and documented production procedure.

## Multi-Agent Execution Strategy

Use the root `AGENTS.md` as the durable coordination contract.

Recommended waves:

1. Parallel read-only domain/database, workbook/scoring, and public/iOS contract
   analysis; primary coordinator produces the approved design.
2. Exclusive writers for migrations/repositories, pure tournament algorithms,
   and golden tests; primary coordinator owns shared wiring.
3. Exclusive admin-auth, admin-UI, and setup/workbook workstreams after stable
   contracts exist.
4. Exclusive event-model, reconciliation, and statistics workstreams.
5. Exclusive standings/bracket, public projection, and iOS workstreams after
   earlier gates pass.
6. Parallel read-only security, migration, and regression reviewers before
   release qualification.

Do not use parallel writers merely to maximize concurrency. Work that depends
on an unsettled shared contract remains sequential.

## Required Test Scenarios

- Multiple tournaments in the same year.
- Main preset validation and generalized balanced configurations.
- Invalid pod sizes, qualifier counts, bracket size, and bye configuration.
- Stable schedule and match IDs across regeneration.
- Setup with no games and correct zero-game display.
- Unknown match time.
- New live sheet, live revision, final revision, and identical reimport.
- Missing and renamed worksheets.
- Ambiguous copied blank scorecard.
- Player replacement before and after completed matches.
- Team-name and pod-assignment mutation rejection after setup.
- Di, Tri, Guy, and every non-make classified once as a miss.
- Forfeit, cancellation, postponement, and incomplete game behavior.
- Standings ties at every tie-break level.
- Pod finalization and attempted finalization with unresolved matches.
- Global qualifier ranking and administrator seed override.
- Bracket generation with and without byes.
- Same teams meeting in pod play and playoffs under distinct match IDs.
- Upstream playoff correction before and after a dependent match starts.
- Comment preservation across match revisions.
- Atomic failure that leaves the prior public projection active.
- Projection-version consistency across tournament and match navigation.
- Scheduled, live, final, forfeited, cancelled, unrecorded, bye, and TBD iOS
  states.
- Legacy 2026 public-response equivalence and legacy endpoint operation.

## Resolved Phase 0 Decisions

The former blocking decisions are now recorded under Accepted Product Decisions.
Implementation-specific constants that do not alter those contracts, such as
session duration, workbook preview retention, writer-lease duration, and page
size, remain local decisions for their owning phase.

## Release Strategy

The current qualified iOS viewer may continue through TestFlight while this
backend/admin refactor is developed, provided the existing public API and
production snapshot remain stable. New public fields should be additive until
an updated client is qualified. Do not submit a final release that claims the
new season lifecycle until setup, incremental ingestion, standings, seeding,
bracket progression, migration, and display states have passed their gates.
