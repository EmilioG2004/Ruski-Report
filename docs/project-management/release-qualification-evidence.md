# Release Qualification Evidence

This file records observed results, not intended coverage. Update it after each
release-candidate run and link any blocker to its GitHub issue.

## Phase 7 Canonical Tournament Engine · Current Candidate

The 2026-08-18 evidence below qualified the legacy release. It does **not**
qualify the canonical tournament engine, legacy backfill, v1/v2 equivalence, or
the Phase 7 rollout. Until current-candidate evidence replaces each `Blocked`
entry, `releaseReady` remains false.

| Gate | Result | Required current-candidate evidence |
| --- | --- | --- |
| Local two-database manifest | Pending | Deterministic sanitized summary; exact candidate commit, clean worktree, Node/Git versions, zero failed local gates, and distinct disposable clean/populated databases. |
| Production-shaped restore | Blocked | Fresh backup digest plus successful isolated restore and protected-row baseline. Requires authorized production backup access. |
| Restored end-to-end lifecycle | Blocked | One database-backed setup-to-champion execution on the isolated restored environment, including correction, standings, seeds, bracket, projection, and realtime continuity. Pure contract traces do not satisfy this gate. |
| Migration/backfill rehearsal | Blocked | Deterministic dry run, atomic apply, second-run no-op, failure injection, protected legacy-row stability, and deep semantic equivalence on the fresh restore. |
| Production migration/apply | Blocked | Explicit production authorization, maintenance window, successful migration/backfill evidence, and rollback owner. |
| V1/v2 public equivalence | Blocked | Version-pinned legacy/v2 read hook and deep restored-database comparison from the same candidate. |
| Production realtime | Blocked | Tournament and changed-match events pinned to the activated projection plus reconnect evidence. |
| Production privacy logs | Blocked | Bounded current-candidate structured/unstructured window with qualification canaries absent. |
| Compact iPhone matrix | Blocked | Current-candidate unit/UI `.xcresult`, light/dark/accessibility, lifecycle/status/content/failure/recovery states. |
| Large iPhone matrix | Blocked | Current-candidate unit/UI `.xcresult`, light/dark/accessibility, lifecycle/status/content/failure/recovery states. |
| Physical iPhone Release pass | Blocked | Current-candidate guest/admin-approved flows, network failure/recovery, old-client compatibility, and no crash. |
| Rollback rehearsal | Blocked | Timed restore of the pre-change backup and prior-application verification on an isolated environment. |

Do not change these items to `Pass` based on code review, a clean synthetic
database, or the earlier release evidence. Attach only privacy-safe counts,
digests, versions, status codes, and artifact identifiers.

## 2026-08-18 · Production And Simulator Matrix

| Gate | Result | Evidence |
| --- | --- | --- |
| Backend TypeScript lint | Pass | `npm run lint` completed without diagnostics. |
| Backend production build | Pass | `npm run build` completed successfully. |
| Backend unit suite | Pass | 208 tests passed in the final backend run; 11 PostgreSQL-gated tests were also qualified separately. |
| PostgreSQL integration | Pass | PostgreSQL 17.11; 11 persistence tests passed. |
| Qualification tool tests | Pass | 8 Node tests passed. |
| iOS Release configuration | Pass | Release validator completed successfully. |
| Production deployment | Pass | API commit `9f9c0d2` deployed; API and PostgreSQL remained healthy. |
| Production read paths | Pass | The final read gate returned one game, 32 teams, 32 standings, 59 matches, match detail, and guest comments from the published tournament. |
| Production publication | Pass | Malformed upload remained atomic; the canonical workbook published and remained readable after completion. |
| Production accounts/community | Pass | Registration, login persistence, sign-out/login, comments, moderation rejection, reports, blocks, unblocks, operator removal, and account deletion passed. |
| Production realtime | Pass | Tournament and comment events, initial connection, and reconnect passed. |
| Production cleanup | Pass | No qualification accounts or comments remained after the write workflow. |
| Production log audit | Pass | A 37-entry post-workflow sample and the prior 1,008-line/963-structured-entry sample passed without displaying content. |
| Compact iPhone unit suite | Pass | iPhone 17e on iOS 26.5; 96 tests passed serially. |
| Compact iPhone UI suite | Pass | iPhone 17e on iOS 26.5; 17 tests passed serially with one simulator destination. |
| Compact accessibility/content | Pass | Accessibility XXXL, long names, scorecard content, labels, unavailable states, and moderation flows passed UI qualification. |
| Large iPhone unit suite | Pass | iPhone 17 Pro Max on iOS 26.5; 96 tests passed serially. |
| Large iPhone UI suite | Pass | iPhone 17 Pro Max on iOS 26.5; 17 tests passed serially with one simulator destination. |
| Large iPhone light appearance | Pass | The standard score feed was inspected with its accessibility hierarchy and rendered without clipping or overlap. |
| Large iPhone dark appearance | Pass | After restarting a stuck simulator runtime, iOS Settings and the standard score feed both rendered correctly in system dark mode. |
| Physical iPhone Release pass | Pass | On a connected, trusted development iPhone, the Release app was exercised through appearance, guest browsing, tournament, bracket, match, score, and turn-based scorebook paths without a crash. |
| Network/failure-state pass | Pass | Thirty-nine focused unit checks covered malformed data, offline errors, expired sessions, and realtime reloads. Serial UI checks covered unavailable launch plus a three-second delayed failure, visible retry, and successful recovery. |
| Final iOS Release validation | Pass | The unsigned archive, resolved production settings, app icons, HTTPS endpoint, ATS posture, and credential-marker scan passed after the fault fixture was added. |

## 2026-08-17 · Development Branch

| Gate | Result | Evidence |
| --- | --- | --- |
| Backend TypeScript lint | Pass | `npm run lint` completed without diagnostics. |
| Backend production build | Pass | `npm run build` completed successfully. |
| Backend unit suite | Pass | 51 suites and 200 tests passed. |
| PostgreSQL integration | Pass | PostgreSQL 17.11; 10 persistence tests passed. |
| Qualification tool tests | Pass | 8 Node tests passed. |
| iOS Release configuration | Pass | Release validator completed successfully. |
| Production API/database health | Pass | `/api/health` reported API and database ready. |
| Production supported games | Pass | Public games endpoint returned the configured game. |
| Production active tournament | Blocked | `/api/tournaments/active` returned HTTP 404. |
| Production realtime | Pass | Initial WSS connection and reconnect succeeded. |
| Production publication/community | Blocked | Requires the environment-only admin token and explicit write opt-in. |
| Compact iPhone simulator | Blocked | iPhone 17e exists but is not booted. |
| Large iPhone simulator | Blocked | iPhone 17 Pro Max exists but is not booted. |
| Physical iPhone Release pass | Blocked | No registered physical device/provisioning is available yet. |
| Production log audit | Pass | 1,008 lines/963 structured entries from a bounded 24-hour API sample passed without displaying content. |

## Issue 45 Closeout Decision

Issue 45 has no remaining release blocker. The live production Pi was not
deliberately stopped, and the physical phone was not placed under 100 percent
packet loss. Equivalent client loading, outage, retry, session-expiration, and
recovery paths passed deterministic qualification instead. This production-safe
substitution is accepted for the v1 qualification closeout; live service
resilience remains part of the TestFlight observation window in issue 47.
