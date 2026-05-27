# ADR 0001: Adopt Node.js and TypeScript for the Backend

## Status

Accepted

## Context

Ruski Report needs a backend because the official tournament data starts in an
Excel workbook, and the iOS app should not parse or validate that workbook
directly. The backend will own upload, validation, normalization, persistence,
and live update publication.

The product also needs game-specific logic without hardcoding Ruski concepts
into every part of the system. Version 1 only supports Ruski, but the design
should leave room for future game modules such as Dye. That requires a backend
structure with clear domain types, parser interfaces, plugin boundaries, config
files, and tests.

The initial hosting target is a Raspberry Pi homelab exposed through a public
tunnel or reverse proxy. The backend should therefore be straightforward to run,
deploy, log, and restart without heavy operational requirements.

## Decision

Use Node.js with TypeScript for the Ruski Report backend.

The backend will be organized as a layered TypeScript service with routes,
controllers, services, repositories, ingestion code, game plugins, domain
models, config, and logging. TypeScript interfaces will define the generic
tournament model and the game plugin contract.

The iOS app will consume normalized API responses from this backend. It will not
read, validate, or transform the Excel workbook itself.

## Rationale

TypeScript fits the project because it gives the backend a typed contract for
the generic tournament model, Ruski plugin interface, scorebook parser outputs,
API DTOs, and realtime event payloads. Those contracts are important because the
app depends on metadata-driven screens rather than Ruski-specific SwiftUI
hardcoding.

Node.js is also a pragmatic fit for Excel ingestion and lightweight APIs. The
ecosystem has mature packages for reading `.xlsx` files, building HTTP APIs,
validating request/response shapes, and running small services on inexpensive
hardware.

This choice keeps the backend flexible enough for future game plugins while
remaining small enough for a first release.

## Alternatives Considered

### Swift Backend

A Swift backend could share language familiarity with the iOS app, but it would
make backend setup, Excel parsing, and server-side ecosystem choices less
straightforward for this project. It also risks coupling app and backend design
too tightly.

### Python Backend

Python has strong Excel and data-processing libraries, and would be a credible
choice for ingestion-heavy work. The tradeoff is weaker end-to-end type
contracts for API payloads and plugin boundaries unless the project adds more
schema tooling and discipline.

### Firebase-Only Backend

Firebase could simplify auth, hosting, and realtime features, but it does not
remove the need for controlled Excel ingestion and game-specific validation. A
Firebase-only approach would push too much custom parsing and normalization into
functions or client workflows before the domain model is stable.

### iOS-Only Workbook Parsing

Parsing the workbook directly in the app would avoid a backend initially, but it
would make validation, live updates, admin upload, comments, and shared
tournament state much harder. It would also require every client to understand
the traditional scorebook format, which conflicts with the viewing-first app
design.

## Consequences

The backend repository structure should be introduced before ingestion work
begins. Upcoming backend issues should assume TypeScript types for domain
models, game plugin interfaces, parser outputs, validation results, repositories,
and API responses.

The project will need Node.js tooling, package management, linting, tests, and a
local dev command as part of the backend foundation milestone.

The design plan remains consistent with this decision: Excel ingestion belongs
to the backend, Ruski-specific logic belongs in a plugin, and the iOS app
receives normalized tournament data from public APIs.

