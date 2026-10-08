# Release Qualification Evidence

This file records observed results, not intended coverage. Update it after each
release-candidate run and link any blocker to its GitHub issue.

## Phase 7 Canonical Tournament Engine · Current Candidate

The current application candidate is
`e5fff7c7d2c42d9ab98df379eb6b0269b5ca43de`. The evidence below qualifies
the completed Phase 7 production rollout. It does **not** authorize a
TestFlight upload or App Store submission; no build was uploaded during this
rollout.

| Gate | Result | Required current-candidate evidence |
| --- | --- | --- |
| Local two-database manifest | Pass | Exact-candidate clean run: 11 gates passed, 0 failed, and 8 external/window gates remained correctly blocked. Two distinct disposable local PostgreSQL 17.11 databases were used. |
| Production-shaped restore | Pass | Encrypted snapshot `9cdf223684f6cf661f41e469fcc08e08589eff0d9fea51dd7460fb883b5a49e8` restored independently for the candidate lifecycle, rollback, and four failure scenarios on PostgreSQL 17.10. Final frozen production snapshot `e46b7c7f6b14154547035757156c05a336e073dceff1984483d7402a51dea043` also passed a clean isolated restore before migration. |
| Restored end-to-end lifecycle | Pass | The isolated restored environment completed setup, beginning/middle/end workbook ingestion, missing-sheet preservation, correction, identical no-op, pod finalization, seeding, override, bracket publication, championship, historical discovery, projection versions 1–9, and version-pinned realtime. |
| Migration/backfill rehearsal | Pass | Exact-candidate dry-run/dry-run/apply/no-op passed. Backfill-apply, projection-materialization, active-pointer, and before-commit faults each rolled back completely, cleaned their fault objects, retried successfully, and ended with a deterministic no-op. |
| Production migration/apply | Pass | The owner authorized the 2026-10-07 production window. Migrations 7–13 applied, production dry-run/dry-run/apply/no-op passed, the protected legacy content digest remained unchanged, and the previous application/database restore path remained available. |
| V1/v2 public equivalence | Pass | The exact candidate served the restored database through an isolated API; all 59 legacy and 59 canonical matches passed the material comparator at projection version 1. |
| Production realtime | Pass | Initial connection and reconnect passed repeatedly through the public production endpoint, including after the physical-client launch. Projection version 1 remained active and coherent. |
| Production privacy logs | Pass | The final bounded candidate window contained 1,158 structured entries, zero error-level entries, and no credential, private-path, sensitive-field, or qualification-canary violations. |
| Compact iPhone matrix | Pass | iPhone 17e / iOS 26.5: 139 unit and 30 distinct Release UI tests passed with zero failures. |
| Large iPhone matrix | Pass | iPhone 17 Pro Max / iOS 26.5: 139 unit and 30 distinct Release UI tests passed with zero failures. |
| Physical iPhone Release pass | Pass | All 30 distinct Release UI scenarios passed on an iPhone 16 Plus / iOS 26.3.1, with one history-card timing failure passing on isolated retry. The preserved installed 1.0 (1) build then launched successfully without reinstalling against the production candidate and remained running while the final public compatibility gate passed. |
| Rollback rehearsal | Pass | The current production image was archived before rehearsal, restored in 11 seconds, and passed health, 59-match legacy reads, comment reads, and realtime connection/reconnect against a fresh restored database. Archive digest and mode-0600 evidence were verified. |

Do not change these items to `Pass` based on code review, a clean synthetic
database, or the earlier release evidence. Attach only privacy-safe counts,
digests, versions, status codes, and artifact identifiers.

## 2026-10-07–08 · Production Migration And Deployment

The owner authorized a 2026-10-07 17:00–18:30 ET production maintenance
window and accepted the documented rollback triggers. Emilio Garcia was the
decision maker; Codex served as database backup/restore operator and
application deploy operator; both observed the rollout. The server cutover
completed during the authorized window. The final physical-client decision
was deliberately withheld while the connected phone was locked, leaving the
candidate under production observation until the owner unlocked it on
2026-10-08 and directed completion. The recorded decision is **proceed**.

| Gate | Result | Evidence |
| --- | --- | --- |
| Pre-change health | Pass | PostgreSQL 17.10, API, Cloudflare tunnel, and host services were healthy with zero failed units. The frozen legacy baseline contained 2,421 rows across the protected tables and digest `ff433f757f9fb995f12f3ca88c8f5b3f44af563ae5f3fa45de92d92e8043bdfa`. |
| Final encrypted backup | Pass | Snapshot `e46b7c7f6b14154547035757156c05a336e073dceff1984483d7402a51dea043`, created 2026-10-07 17:01:59 ET after the write path stopped, passed a clean isolated restore through the 2026 tournament read. The ordinary hourly timer resumed and subsequent backups succeeded. |
| Additive migration | Pass | The exact candidate artifact applied migrations `0007_tournament_engine.sql` through `0013_legacy_backfill_provenance.sql`; all 13 migrations were then present. No down migration or ad-hoc SQL was used. |
| Production backfill | Pass | Two dry runs matched the rehearsal exactly with zero issues. Apply succeeded and the second apply was a deterministic no-op. Source `808caaaefe71a88d87890976a1c3c72b1c4db8496d19fe330670a4223e8a8bec`, plan `c6a37ac61b4bba97641a3d451f1e8acfa06a5f08384b08e817a5ac7497602fcc`, and mapping `947ce8e10ea88d842ddaf571f0b412b715705575677dbf32a7735b1e1c0e81ea` matched the restored rehearsal. |
| Legacy preservation | Pass | The production-specific protected checkpoint digest was `c9270916d8fdb15d492f9193bc920a1db26b47c891b38015062f8b69df466696`. The independent protected content digest remained exactly `ff433f757f9fb995f12f3ca88c8f5b3f44af563ae5f3fa45de92d92e8043bdfa` before and after apply. |
| Canonical projection | Pass | One completed tournament, 59 canonical matches, 59 match payloads, and one active projection pointer at version 1 were present. The event-derived correction checkpoint contained 55 bounded corrections with digest `ba6170004615be21746526cab0e547bf06097292046231594da8274cc0dcea6e`. |
| Exact deployment | Pass | Production checkout and running API image resolved to candidate `e5fff7c7d2c42d9ab98df379eb6b0269b5ca43de` and immutable image `sha256:19a257048e1a1887e102cf15fc51823af0651a2c9407c6d22fab37b3ef6ce73b`. The previous image and protected rollback archive were retained. |
| Public compatibility | Pass | Repeated public gates returned 1 game, 32 teams, 32 standings, 59 legacy matches, 59 canonical matches, zero active canonical tournaments, one historical tournament, projection version 1, material v1/v2 equivalence, the preserved legacy workbook route behind HTTP 401, and realtime connection/reconnect. |
| Administrator and privacy canaries | Pass | The private sign-in page returned HTTP 200 and a synthetic invalid legacy administrator credential remained HTTP 401. The final privacy audit passed 1,158 structured entries with zero API or PostgreSQL errors and no canary or sensitive-field leak. |
| Physical installed-client check | Pass | The already-installed Ruski Report 1.0 (1) build on the registered iPhone 16 Plus launched without reinstalling, remained running, and was followed by another successful public read/equivalence/realtime gate. |
| Observation and decision | Proceed | The exact candidate remained healthy for approximately 24 hours with zero API error-level entries, zero PostgreSQL errors, coherent projection version 1, successful scheduled backups, and no rollback trigger. No TestFlight or App Store upload occurred. |

## 2026-10-07 · Restored Lifecycle, Failure Injection, And Rollback

This section records the successful pre-window rehearsal for application
candidate `e5fff7c7d2c42d9ab98df379eb6b0269b5ca43de`, using qualification tooling
at `49e245cb7bce1974396fd31efb4e057f8fc15cba`. Evidence and the rollback image
archive are retained outside Git with mode `0600`. No candidate was deployed,
no production database write occurred, and no build was uploaded.

| Gate | Result | Evidence |
| --- | --- | --- |
| Candidate identity | Pass | Immutable candidate image `sha256:19a257048e1a1887e102cf15fc51823af0651a2c9407c6d22fab37b3ef6ce73b` carried the exact application commit label. Qualification source and image were separately pinned to the full tooling commit. |
| Local two-database manifest | Pass | Clean candidate worktree; 11 passed, 0 failed, 8 blocked. Lint, build, production dependency audit, 555 unit tests, 140 lifecycle tests, 9 projection/realtime transaction tests, 90 PostgreSQL integration tests, 63 qualification-tool tests, iOS Release configuration, and the four-page policy-site check passed. |
| Fresh encrypted restore | Pass | Snapshot `9cdf223684f6cf661f41e469fcc08e08589eff0d9fea51dd7460fb883b5a49e8`, created 2026-10-07 14:03:07 ET, restored into dedicated internal Docker networks with no published ports. Thirteen migrations were present. |
| Deterministic backfill | Pass | Two dry runs matched; apply succeeded; retry was a no-op. Protected legacy state remained unchanged and the material equivalence comparator passed 59 legacy and 59 canonical matches at projection version 1. |
| Failure injection | Pass | Independent fresh restores passed `backfill-apply`, `projection-materialization`, `active-pointer`, and `before-commit`. Every injected failure left canonical artifacts absent, active pointers and compatibility identities unchanged, legacy reads intact, and fault objects removed before a successful retry/no-op. |
| Full lifecycle | Pass | Thirteen gates passed from setup publication through completed champion discovery. Four imports applied, two no-opped, one correction created an immutable revision, and one missing sheet remained non-destructive. Nine coherent public projection versions activated. |
| Lifecycle realtime | Pass | Nine tournament events and eight changed-match events were emitted, all pinned to the activating projection version. |
| Candidate API and realtime | Pass | Isolated candidate API equivalence passed; the protected legacy workbook route remained registered behind HTTP 401. Initial realtime connection and reconnect both passed. |
| Rollback artifact | Pass | Prior image `sha256:f1c70114270a9bc39da23c088a97a8ddbcfcc51a66f1a6f2d1baa58d8934bfab` was archived with SHA-256 `069eb1f5dbe90a055cd5febddc6e0334b34de4fdb166b75f548c90c8942ba796`; the independently recomputed digest matched. |
| Rollback execution | Pass | The prior image restored in 11 seconds and passed health, 59-match legacy reads, comment reads, and realtime connection/reconnect. |
| Isolation and cleanup | Pass | The live API remained healthy on tag `9f9c0d2`. Final labeled rehearsal container and network counts were both zero. |
| Regression discovered and fixed | Pass | Rehearsal found that cumulative playoff workbook sheets were validated before their deferred playoff matches materialized. The atomic transaction now permits only explicitly deferred playoff matches and revalidates the complete manifest after bracket materialization. The PostgreSQL workbook suite passed all 14 tests. |

## 2026-10-05 · Exact-Candidate Qualification Evidence

This section records observed evidence for
`c4e84ce960617684eee18152b0a999530ea5a5c0`. Evidence artifacts are retained
outside Git. No candidate image was deployed and no build was uploaded.

| Gate | Result | Evidence |
| --- | --- | --- |
| Candidate identity | Pass | The worktree was clean at qualification start and the local manifest, Pi source tree, image revision label, and evidence all resolved to the full candidate SHA. |
| Local two-database gate | Pass | 11 passed, 0 failed, 8 blocked. Backend lint/build and runtime dependency audit passed; 554 backend unit tests, 139 lifecycle tests, projection/realtime transaction coverage, PostgreSQL integration coverage, 44 qualification-tool tests, iOS Release validation, and policy-site validation passed. |
| Runtime dependency posture | Pass | The exact ARM64 runtime image audited 230 production packages with 0 vulnerabilities. |
| Candidate image | Pass | `sha256:d3ed504dba98890a8f7a94e0530ff46688695bc4416ff0f4bed348d6ffa9bdd7`, carrying the exact candidate revision label. |
| Isolated production restore | Pass | Encrypted snapshot `9922d4763b978c3e2bea7aa2f826b23994581e1a7dd7672f359dc978b8e1a583` restored successfully. Database dump SHA-256: `55113c2691a6c6aa6747625859f5e4c96792903283b4eee08b7b02de4bfce4ea`; PostgreSQL 17.10; 13 migrations. |
| Deterministic legacy backfill | Pass, except failure-injection subgate | Two dry runs matched, one apply succeeded, and the second apply was a deterministic no-op. The protected legacy digest remained `b07fe794f04e9532930df75703b16ef0c590ae7c0cf00dd4ebb77d5fb7a374d9`. Restored-environment failure injection is still blocked. |
| Backfill identity and counts | Pass | Source `808caaaefe71a88d87890976a1c3c72b1c4db8496d19fe330670a4223e8a8bec`, plan `c6a37ac61b4bba97641a3d451f1e8acfa06a5f08384b08e817a5ac7497602fcc`, mapping `947ce8e10ea88d842ddaf571f0b412b715705575677dbf32a7735b1e1c0e81ea`; 1 tournament, 32 teams, 65 players and memberships, 8 pods, 59 matches and revisions, 118 participants, 4,163 scoring events, 4,156 shot attempts, 32 standings, 16 seeds, 15 bracket matches, 7,390 statistic values, one projection version, and 59 projected match payloads. |
| Event-derived statistic correction checkpoint | Pass | Policy `canonical_match_events_v1`; 55 bounded corrections; deterministic digest `ba6170004615be21746526cab0e547bf06097292046231594da8274cc0dcea6e`. |
| Restored v1/v2 public equivalence | Pass | 59 legacy and 59 canonical matches, one historical tournament, projection version 1, and the protected legacy workbook route remained registered behind HTTP 401. |
| Compact simulator | Pass | `simulator-c4e84ce-unit-debug.xcresult`: 139/139. `simulator-c4e84ce-compact-ui-release.xcresult`: 30/30 distinct UI tests, including light/dark, accessibility, lifecycle/status/content, offline, delayed-failure, retry, and recovery states. |
| Large simulator | Pass | `simulator-c4e84ce-large-unit-debug.xcresult`: 139/139. `simulator-c4e84ce-large-ui-release.xcresult`: 30/30 distinct UI tests across the same state matrix. |
| Physical Release UI | Pass with isolated environmental retry | `physical-c4e84ce-ui-release.xcresult`: 29/30 distinct tests passed; one history-card wait failed. `physical-c4e84ce-history-retry.xcresult`: that exact test passed alone. All 30 scenarios therefore passed on the exact candidate without a crash. |
| Exact signed App Store export | Pass | Version 1.0 (1), bundle `com.emiliogarcia.ruskireport`, Apple Distribution signing, profile `Ruski Report App Store 2026`, `get-task-allow=false`, Release API `https://api.ruskireport.com/api`, valid privacy manifest, and no forbidden development/server markers. IPA SHA-256: `a50e49993fae12d92b25f9e2f16bc2848576ea83480ac9cab39207ab7c31752a`. The IPA was not uploaded. |
| Live production isolation | Pass | Production remained on `9f9c0d298d51e2ef8a982ac6c20777b639a302ce`; the rehearsal used temporary containers and did not stop or mutate the live API or PostgreSQL database. |

## 2026-10-05 · Earlier Apple And Physical-Device Evidence

This is historical partial Phase 7 evidence for candidate
`60cd9f1e1bab251518e35fd83bb30d091f05328b`.
It does not replace the blocked Release-device, simulator, restored-database,
or production gates above.

| Gate | Result | Evidence |
| --- | --- | --- |
| Apple development connection | Pass | The enrolled team became visible in Xcode; a registered iPhone 16 Plus on iOS 26.3.1 (a) connected over USB with Developer Mode and developer disk-image services enabled. |
| Signed development build | Pass | Xcode provisioned, installed, and launched the current candidate on the registered phone. |
| Signed distribution archive | Pass | Version 1.0 (1), bundle `com.emiliogarcia.ruskireport`, Release API `https://api.ruskireport.com/api`, Apple Distribution signing, App Store provisioning, and `get-task-allow=false` were verified. |
| Exported IPA digest | Pass | SHA-256 `093cb6d2d30a2677a813ccbe7f23ec67bfdb8f78d865fb17cb63349ad9e578b7`; the export was not uploaded. |
| Physical preview smoke | Pass | `Smoke.xcresult`: one deterministic bundled-preview home-to-match UI test passed. |
| Physical preview matrix | Pass with isolated environmental retry | `FullPreview.xcresult`: 28 of 29 tests passed; one test was interrupted by an iOS notification banner. `AccountCancellationRetry.xcresult`: the interrupted test passed alone. All 29 deterministic preview scenarios therefore passed on the physical phone without production traffic. |
| Physical Release preview matrix | Pass | `physical-60cd9f1-preview-ui-release.xcresult`: all 29 deterministic bundled-preview UI tests passed under the Release configuration with zero failures in 500.316 seconds. The ordinary launch test was deliberately excluded so the qualification run could not contact the production API. |
| Physical iPhone Release gate | Blocked | The current candidate now has a clean physical Release preview matrix. Release-endpoint guest/admin-approved flows, network failure/recovery, and old-client compatibility remain required before the complete gate can pass. |

## 2026-10-05 · Homelab Inspection And Pre-Window Evidence

This inspection did not deploy the candidate or alter the production database.
The live application remained on commit
`9f9c0d298d51e2ef8a982ac6c20777b639a302ce` throughout.

| Gate | Result | Evidence |
| --- | --- | --- |
| WireGuard and SSH management path | Pass | The recovered `Emi Mac` tunnel connected, the WireGuard gateway and Pi LAN path were reachable, and SSH connected over the private route. |
| Production host baseline | Pass | ARM64 Pi, Docker active/enabled, zero failed systemd units, Compose configuration valid, and API/PostgreSQL/cloudflared containers healthy. The API remained bound to loopback and PostgreSQL had no host-published port. |
| Production database baseline | Pass | PostgreSQL 17.10 with migrations 1–6. Privacy-safe cardinalities: 1 tournament, 7 snapshot versions, 398 matches, 224 teams, 448 players, 224 standings, 11 upload reports, 0 comments, and 0 user accounts. |
| Public baseline | Pass | HTTPS API/database health passed; WSS initial connection and reconnection passed. |
| Encrypted backup freshness | Pass | Snapshot `9922d4763b978c3e2bea7aa2f826b23994581e1a7dd7672f359dc978b8e1a583` completed at 2026-10-05 23:04:37 ET. The hourly backup and weekly repository-integrity jobs both reported success. |
| Existing-artifact clean restore | Pass (partial Phase 7 evidence) | The newest snapshot restored into isolated temporary PostgreSQL/API containers and completed its read verification in 17 seconds. The live containers and database were not stopped or modified. This used the deployed pre-Phase-7 artifact, so candidate migration/backfill/equivalence and rollback gates remain blocked. |
| Candidate container preflight | Pass | Exact-candidate image `sha256:d3ed504dba98890a8f7a94e0530ff46688695bc4416ff0f4bed348d6ffa9bdd7` passed the restored migration/backfill/equivalence rehearsal. Its production runtime audited 230 packages with 0 vulnerabilities. Earlier candidate images remain quarantined and no candidate was deployed. |
| Persistent storage readiness | Blocked for a live tournament | PostgreSQL remains on the 128 GB microSD filesystem (103 GB free). The deployment runbook requires moving persistent PostgreSQL storage to a USB 3 SSD before a live tournament. |

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
