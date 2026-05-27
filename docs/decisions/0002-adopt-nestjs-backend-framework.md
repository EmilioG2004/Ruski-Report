# ADR 0002: Adopt NestJS as the Backend Framework

## Status

Accepted

## Context

ADR 0001 established that the Ruski Report backend will use Node.js and
TypeScript. The next decision is how the backend should be structured as an HTTP
API service.

The backend needs more than simple route handling. It must support admin
scorebook uploads, request validation, structured errors, tournament APIs,
comments, authentication/authorization, persistence boundaries, game-specific
ingestion logic, and future realtime updates.

Ruski Report is also intended to demonstrate production-style backend
architecture. The framework should make the system easier to reason about,
test, and explain instead of leaving structure entirely to convention.

## Decision

Use NestJS as the backend framework for the Node.js/TypeScript service.

NestJS will provide the application structure for modules, controllers,
services, providers, guards, pipes, filters, and tests. The backend will still
follow the layered architecture from the design plan:

```text
routes/controllers -> services -> repositories
                 ingestion -> games/plugins
```

NestJS modules will organize backend features such as tournaments, matches,
comments, admin upload, ingestion, and games. The Ruski game plugin remains a
domain-level plugin concept inside the backend; it is separate from NestJS's
framework plugin/provider system.

## Rationale

NestJS is a strong fit because Ruski Report needs clear boundaries between API
controllers, business workflows, repositories, authentication, ingestion, and
game-specific logic. NestJS gives those boundaries a consistent structure.

The framework also provides useful built-in patterns for this project:

- Controllers for public and admin API endpoints.
- Services/providers for tournament workflows and scorebook ingestion.
- Dependency injection for swapping repositories, game plugins, and test
  doubles.
- DTO validation through pipes for request parameters and upload metadata.
- Guards for admin-only upload endpoints and future authenticated comments.
- Exception filters for consistent API error responses.
- Testing utilities for controller and service-level tests.
- Optional OpenAPI/Swagger support for documenting the API.

The additional structure is acceptable because this project is not only a quick
prototype. It is meant to become a maintainable app and a resume-quality example
of backend architecture.

## Alternatives Considered

### Fastify

Fastify is lightweight, fast, and TypeScript-friendly. It would be a good
choice for a smaller API service and provides strong validation and logging
support.

Fastify was not selected because it leaves more architectural decisions to the
project. Ruski Report benefits from a more opinionated framework that makes
controllers, services, dependency injection, guards, validation, and tests
visible in the codebase.

### Express

Express is the most common Node.js web framework and has a large ecosystem. It
is easy to learn and easy to find examples for.

Express was not selected because it is intentionally minimal. The project would
need to define more conventions manually for validation, error handling,
dependency wiring, service boundaries, and testing. That flexibility is useful
in some projects, but Ruski Report needs consistent structure early.

### Hono

Hono is a small, modern, TypeScript-friendly framework. It is attractive for
lean APIs and edge/serverless deployments.

Hono was not selected because Ruski Report's backend is expected to handle file
uploads, ingestion workflows, persistence, auth, and long-running homelab
deployment rather than only a small edge-style API.

### Raw Node.js HTTP Server

A raw Node.js HTTP server would avoid framework dependencies.

This was rejected because the project would immediately need to rebuild common
framework concerns such as routing, validation, file upload handling, error
mapping, tests, and middleware-like request processing.

## Consequences

The backend foundation milestone should scaffold a NestJS application rather
than a minimal Express or Fastify app.

Backend code should be organized around NestJS modules while preserving the
domain boundaries in the design plan. Controllers should stay thin, services
should own workflows, repositories should hide persistence details, and the
Ruski game plugin should own Ruski-specific parsing and stat behavior.

The project will need team discipline to avoid over-abstracting. NestJS should
be used for clear structure, validation, dependency injection, guards, and
tests, not for unnecessary enterprise ceremony.

Future backend issues should assume NestJS conventions when discussing routes,
controllers, services, guards, pipes, filters, modules, and testing.

