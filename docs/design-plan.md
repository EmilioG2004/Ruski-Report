# Ruski Report Design Plan

## Summary

Build Ruski Report as a viewing-first SwiftUI app backed by a Node/TypeScript service. The backend ingests the official non-negotiable Excel scoresheet through an admin upload flow, validates it through a game-specific plugin, converts it into normalized tournament data, stores it, and pushes live updates to the iOS app.

The platform should be generic enough to support future games like Dye, while v1 implements only the `Ruski` game module. Generic tournament infrastructure should not hardcode Ruski-specific stats or rules. User-created games and in-app scoring remain deferred until the scoring platform phase.

## Architecture

Use strict MVC separation in the iOS app plus a data layer:

```text
iOS App
  Models/          Domain values only
  Views/           SwiftUI rendering only
  Controllers/     Screen state and user actions
  Data/            API clients, repositories, DTO mapping
  Services/        Auth, logging, configuration, error mapping
```

Use a layered Node/TypeScript backend:

```text
Backend
  routes/          Public HTTP and realtime API boundaries
  controllers/     Request validation and response orchestration
  services/        Business workflows
  repositories/    Database access
  ingestion/       Excel upload and parser orchestration
  games/           Game plugins: Ruski first, Dye later
  domain/          Generic tournament/match/team/player models
  config/          Externalized JSON/env configuration
  logging/         Structured logs and error reporting
```

The Excel workbook remains the traditional source format. The app never parses Excel directly. The backend owns Excel ingestion.

## Generic Platform Model

Keep these concepts game-agnostic:

- `Tournament`
- `TournamentFormat`
- `Pod`
- `Team`
- `Player`
- `MatchSummary`
- `MatchDetail`
- `MatchStatus`
- `Bracket`
- `BracketRound`
- `Standing`
- `Comment`
- `LiveUpdateEvent`

Represent game-specific scoring through configurable event/stat models:

- `GameDefinition`
- `GameEventType`
- `GameEvent`
- `GamePhase`
- `ScorecardDefinition`
- `ScorecardRow`
- `StatDefinition`
- `BoxScore`

Ruski-specific examples become data/plugin behavior, not core model fields:

- `miss`
- `make`
- `splashOut`
- `guy`
- `tri`
- `di`
- `vom`
- `redemption`
- `overtime`

## Game Plugin Design

Each supported game gets a backend plugin. V1 ships only `RuskiGamePlugin`.

Game plugin interface:

- `gameType: string`
  - Justification: identifies the plugin for upload, validation, storage, and API responses.
- `loadDefinition(): GameDefinition`
  - Justification: exposes labels, phases, stat categories, and scorecard display metadata.
- `parseScorebook(file: Buffer): Promise<ParsedScorebook>`
  - Justification: each game may have a different traditional scorekeeping format.
- `validateScorebook(parsed: ParsedScorebook): ValidationResult`
  - Justification: each game owns its required tabs, headers, scorecard layout, and stat rules.
- `normalizeScorebook(parsed: ParsedScorebook): Promise<TournamentSnapshot>`
  - Justification: converts game-specific source data into generic tournament/match structures.
- `calculateStats(events: GameEvent[]): BoxScore`
  - Justification: stat semantics differ by game and should not be hardcoded globally.

Ruski plugin responsibilities:

- Validate the expected workbook tabs.
- Validate the traditional scorecard layout.
- Convert each game tab into scorecard rows/events.
- Treat `Di` and `Tri` as special misses, not makes.
- Preserve Ruski phases such as Guy2Guy, normal play, redemption, and overtime.
- Generate standings, box scores, bracket state, and match summaries.

Future Dye plugin responsibilities would be added separately without changing generic tournament screens.

## Backend Public Interfaces

Public backend endpoints:

- `POST /admin/tournaments/:year/upload-scorebook?gameType=ruski`
  - Accepts the official workbook and routes ingestion to the matching game plugin.
- `GET /games`
  - Returns supported game definitions.
- `GET /tournaments/active`
  - Returns the active tournament summary.
- `GET /tournaments/:id`
  - Returns tournament detail, pods, standings, bracket metadata, and game type.
- `GET /tournaments/:id/matches`
  - Returns match summaries only.
- `GET /matches/:id`
  - Returns match detail, box score, scorecard definition, scorecard rows, phase, and comments summary.
- `GET /matches/:id/comments`
  - Returns comments for a match.
- `POST /matches/:id/comments`
  - Adds a comment for authenticated users.
- `GET /events`
  - Opens Server-Sent Events or WebSocket stream for tournament/match updates.

All other backend functions remain private/module-internal.

## iOS Interfaces

Controllers depend on protocols, not concrete clients:

- `GameDefinitionRepository.fetchSupportedGames() async throws -> [GameDefinition]`
  - Justification: app needs display metadata for game-specific labels and scorecard columns.
- `TournamentRepository.fetchActiveTournament() async throws -> TournamentSummary`
  - Justification: home screen requires active tournament data.
- `TournamentRepository.fetchTournament(id:) async throws -> TournamentDetail`
  - Justification: tournament screen requires pods, standings, bracket, and match metadata.
- `MatchRepository.fetchMatches(tournamentID:) async throws -> [MatchSummary]`
  - Justification: match list should use lightweight data.
- `MatchRepository.fetchMatchDetail(matchID:) async throws -> MatchDetail`
  - Justification: full scorecard is loaded only when needed.
- `CommentRepository.fetchComments(matchID:) async throws -> [Comment]`
  - Justification: comments are optional match-scoped data.
- `CommentRepository.postComment(matchID:text:) async throws -> Comment`
  - Justification: authenticated users need one controlled write path.
- `RealtimeTournamentClient.subscribe(to:) -> AsyncStream<TournamentEvent>`
  - Justification: app needs live pushed updates without coupling views to transport details.
- `AuthSessionProviding.currentSession() async -> AuthSession`
  - Justification: views need guest/account/admin state without knowing auth implementation.
- `AppLogging.info/warning/error(...)`
  - Justification: app errors and data refresh behavior need consistent reporting.

Swift access control: default to `private`; use `internal` only across files; use `public` only if code moves into a shared package.

## Screens And UI

Initial screens:

- Home: official tournament card, featured/live matches.
- Tournament Detail: tabs for Pods, Bracket, Matches, Stats.
- Pod Standings: generic standings view driven by tournament data.
- Bracket View: generic bracket display.
- Match Detail: game-aware score header, box score, scorecard, shot/event log, comments.
- Account/Guest State: lightweight guest/account distinction.

Scorecard UI must be metadata-driven:

- Column labels come from `ScorecardDefinition`.
- Event badges come from `GameEventType`.
- Stat labels come from `StatDefinition`.
- Ruski scorecard layout mirrors the traditional Excel sheet.
- Future games can define different labels and scorecard columns without rewriting generic screens.

## External Configuration

Backend config:

- `games/ruski/rules.json`: phases, event types, labels, stat semantics, scorecard metadata.
- `games/ruski/scorebook-schema.json`: expected workbook tabs, headers, scorecard cell regions.
- `tournament-config.json`: active year, expected format, pod count, bracket size.
- `.env`: database URL, admin auth secret, tunnel/public base URL, logging level.

iOS config:

- `AppConfig.plist` or bundled JSON for API base URL, realtime endpoint, feature flags, and refresh fallback interval.

No tournament data is manually translated into JSON. Tournament snapshots are generated only by backend ingestion.

## Error Handling And Logging

Backend logs:

- upload started/completed
- selected `gameType`
- plugin validation failures
- missing/renamed tabs
- malformed scorecard rows
- stat normalization failures
- publish success/failure
- realtime connection lifecycle

iOS logs:

- API request failures
- realtime disconnect/reconnect
- unsupported game definition
- scorecard definition mismatch
- decoding failures
- stale data fallback
- user-visible error presentation

Backend returns structured errors:

```json
{
  "code": "SCOREBOOK_VALIDATION_FAILED",
  "message": "Scorebook could not be published.",
  "details": []
}
```

Controllers map technical errors into user-friendly messages.

## Hosting

V1 hosting target: Raspberry Pi homelab with public tunnel/reverse proxy.

Required components:

- Node/TypeScript backend process managed by systemd or Docker.
- SQLite for earliest prototype; Postgres preferred once comments/auth are active.
- Uploaded workbook storage on disk with backups.
- Caddy/Nginx/Cloudflare Tunnel/Tailscale Funnel for public HTTPS access.
- Health endpoint and structured log files.

## Test Plan

Backend tests:

- selects correct game plugin from `gameType`.
- rejects unsupported game types.
- validates all required Ruski workbook tabs exist.
- rejects changed Ruski scorecard headers/layout.
- confirms Ruski `Di` and `Tri` count as misses.
- converts sample Ruski game tabs into normalized scorecards.
- stores tournament snapshot atomically.
- publishes realtime event after successful ingestion.
- rejects invalid admin upload.

iOS tests:

- home screen loads active tournament.
- tournament screen renders pods, standings, bracket, and matches.
- match detail renders metadata-driven box score and scorecard.
- Ruski event labels render from game definition.
- realtime event updates visible match state.
- API failure shows readable error state.
- guest users can view; unauthenticated users cannot post comments.

## Assumptions

- Backend stack is Node/TypeScript.
- Excel ingestion uses admin upload.
- Live updates use server push via WebSocket or Server-Sent Events.
- Hosting target is homelab Raspberry Pi plus public tunnel.
- V1 implements only the Ruski game plugin.
- The generic platform is designed for future games, but arbitrary game logic is not expected to be expressible through JSON alone.
- Game-specific logic lives in plugins; game-specific labels/layouts/rule metadata live in config files.
- V1 is viewing-first; game instantiation and scoring UI are future features.
