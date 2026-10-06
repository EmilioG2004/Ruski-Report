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
| Physical iPhone Release pass | Blocked (partial evidence recorded below) | Current-candidate guest/admin-approved flows, network failure/recovery, old-client compatibility, and no crash. |
| Rollback rehearsal | Blocked | Timed restore of the pre-change backup and prior-application verification on an isolated environment. |

Do not change these items to `Pass` based on code review, a clean synthetic
database, or the earlier release evidence. Attach only privacy-safe counts,
digests, versions, status codes, and artifact identifiers.

## 2026-10-05 · Current-Candidate Apple And Physical-Device Evidence

This is partial Phase 7 evidence for candidate `60cd9f1e1bab251518e35fd83bb30d091f05328b`.
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
| Encrypted backup freshness | Pass | Snapshot `0fc4c3405fbe3417b5b9eec540ccbc51e913e49fb1d263d6f151be1647a31a39` completed at 2026-10-05 21:01:47 ET. The hourly backup and weekly repository-integrity jobs both reported success. |
| Existing-artifact clean restore | Pass (partial Phase 7 evidence) | The newest snapshot restored into isolated temporary PostgreSQL/API containers and completed its read verification in 17 seconds. The live containers and database were not stopped or modified. This used the deployed pre-Phase-7 artifact, so candidate migration/backfill/equivalence and rollback gates remain blocked. |
| Candidate container preflight | Previous candidate blocked; replacement prepared | Image `sha256:2610cc1fdf12760dd9759fd30c6ea8e53128bc98c083b22494d7394ecdedf7de` was built from `60cd9f1e1bab251518e35fd83bb30d091f05328b` but is quarantined after the current production audit identified critical advisory `GHSA-jqcg-44mw-7w3h` in transitive `proxy-addr` 2.0.7. The replacement lockfile uses 2.0.8; production audit, lint, build, and 17 focused proxy/security tests pass. The replacement commit and artifact require exact-candidate requalification before deployment. |
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
