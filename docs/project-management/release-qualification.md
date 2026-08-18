# Release Qualification

This runbook is the repeatable gate for GitHub issue 45. It separates safe,
read-only checks from production-changing workflows and records results in
[release qualification evidence](release-qualification-evidence.md).

## Safety Contract

- Configuration defaults live in
  `scripts/release-qualification/defaults.json`; environment variables may
  override them without changing code.
- Read-only qualification never creates, updates, or deletes production data.
- Production writes require both `RUSKI_QUALIFICATION_ALLOW_WRITES=YES` and an
  environment-provided `RUSKI_QUALIFICATION_ADMIN_TOKEN`.
- Synthetic account credentials stay in memory. Both accounts are deleted in a
  `finally` cleanup, including their sessions, blocks, and authored comments.
- HTTP failures omit response bodies, and the tooling never prints credentials.

## Local Gates

Install dependencies in `backend`, make a disposable PostgreSQL database
available, then run:

```bash
export TEST_DATABASE_URL=postgresql://127.0.0.1:55432/ruski_report_test
node scripts/release-qualification/run.mjs local
```

The command requires PostgreSQL rather than accepting Jest's skipped
integration suite. It runs TypeScript lint, the production build, all backend
tests, PostgreSQL integration, qualification-tool tests, iOS release validation,
and policy-site validation.

## Production Read Gate

```bash
node scripts/release-qualification/run.mjs production-read
```

This verifies API/database health, games, the active tournament, teams,
standings, matches, one match detail, guest comments, and initial/reconnected
WSS handshakes. It fails if production has no active tournament or match.

## Production Write Gate

Load the admin token into the shell without committing it, review
`defaults.json`, and deliberately opt in:

```bash
read -s RUSKI_QUALIFICATION_ADMIN_TOKEN
export RUSKI_QUALIFICATION_ADMIN_TOKEN
export RUSKI_QUALIFICATION_ALLOW_WRITES=YES
node scripts/release-qualification/run.mjs production-write
unset RUSKI_QUALIFICATION_ADMIN_TOKEN RUSKI_QUALIFICATION_ALLOW_WRITES
```

The workflow proves malformed-workbook rejection leaves the active snapshot
unchanged, publishes the configured workbook, reruns the full read gate, and
uses disposable accounts to verify registration, persisted login, sign-out,
comments, moderation rejection, reports, blocking, unblocking, operator removal,
and account deletion.

## iOS Simulator Matrix

Run the complete unit and UI schemes on both current representative sizes:

- Compact: iPhone 17e, portrait, light and dark appearance.
- Large: iPhone 17 Pro Max, portrait, light and dark appearance.

Retain the `.xcresult` summaries and screenshots of standard, unavailable,
long-content, authenticated, reporting, and blocking states. Repeat the core
home-to-match path at an accessibility Dynamic Type size with VoiceOver labels
visible in Accessibility Inspector.

## Fault And Device Pass

On a registered physical iPhone using the Release endpoint:

1. Exercise guest browsing, registration, relaunch persistence, sign-out, login,
   comments, reports, blocks, and account deletion.
2. Use Network Link Conditioner for high latency and 100% loss. Confirm visible
   loading/error/retry states and recovery after returning to a healthy link.
3. Stop the backend only during an agreed maintenance window, confirm safe
   outage behavior, restart it, and verify automatic/manual recovery.
4. Inspect long names, dense scores, bracket, standings, event log, scorecard,
   comments, keyboard avoidance, and Dynamic Type.

## Privacy-Safe Log Gate

Export a representative production application-log window as plain lines, then
run:

```bash
node scripts/release-qualification/run.mjs logs /path/to/application.log
```

The audit scans every line for credential patterns and recursively rejects
sensitive structured fields. It reports only line numbers and rule names. At
least one useful structured application entry is required; unrelated framework
startup lines are allowed.
