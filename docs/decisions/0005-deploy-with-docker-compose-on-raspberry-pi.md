# ADR 0005: Deploy with Docker Compose on Raspberry Pi

## Status

Accepted

## Context

Ruski Report needs a deployment target for the NestJS backend, PostgreSQL
database, WebSocket gateway, admin scorebook upload flow, stored workbook files,
logs, and backups.

The product plan already assumes a Raspberry Pi homelab deployment exposed
through a public tunnel or reverse proxy. The deployment approach should be
simple enough to operate personally while still being reproducible and credible
as a production-style architecture.

The backend also needs long-running process support. Serverless deployment is
not a natural fit because the app uses WebSockets, workbook uploads, local
storage, PostgreSQL, and background-style ingestion workflows.

## Decision

Deploy the backend stack to a Raspberry Pi using Docker Compose.

The Compose deployment will run at least these services:

- NestJS backend API.
- PostgreSQL database.
- Public HTTPS/WSS access through a reverse proxy or tunnel.

Persistent Docker volumes or mounted host directories will store PostgreSQL
data, uploaded scorebooks, and any generated ingestion artifacts that must
survive container restarts.

The deployment should include a health check, structured logs, restart policy,
backup process, and documented restore process.

## Rationale

Docker Compose gives the project a reproducible deployment without requiring
Kubernetes or a hosted platform. The backend, database, and networking concerns
can be described in version-controlled configuration instead of manual server
setup steps.

This is a good fit for Raspberry Pi hosting because it keeps the operational
model small:

- One machine.
- One Compose stack.
- Clear service boundaries.
- Persistent volumes for database and uploads.
- Restart behavior configured in one place.

Docker Compose also leaves a migration path. If the app later moves from a
Raspberry Pi to a VPS, the service definitions and operational model can mostly
come with it.

This choice supports the project's resume goal by showing containerized
deployment, PostgreSQL operations, public HTTPS/WSS exposure, health checks,
logs, and backup planning without adding unnecessary orchestration complexity.

## Alternatives Considered

### Raspberry Pi with Systemd

Running the NestJS backend and PostgreSQL directly on the Pi with `systemd`
would be simpler at runtime and would teach direct Linux service management.

This was not selected because it is less reproducible. Node.js versions,
environment variables, database setup, logs, and restart behavior would be more
dependent on manual machine configuration.

### Cloud VPS with Docker Compose

A small VPS would provide more reliable public hosting and simpler networking
than a homelab Pi.

This was not selected for the initial deployment because the current project
plan targets a Raspberry Pi homelab. Docker Compose keeps the option open to
move to a VPS later if uptime or network reliability becomes more important.

### Platform as a Service

Services such as Render, Railway, Fly.io, or Heroku-style platforms can make
deployment fast and provide managed logs, restarts, and databases.

This was not selected because the project already has a custom backend,
PostgreSQL, WebSockets, workbook upload storage, and a desire to demonstrate
infrastructure ownership. A PaaS may still be useful later if operating the Pi
becomes a distraction.

### Serverless

Serverless functions work well for stateless request/response APIs.

This was rejected because Ruski Report uses long-lived WebSocket connections,
file uploads, database-backed ingestion workflows, and local persistent
artifacts. Those requirements fit a long-running backend service better than a
serverless function model.

### Kubernetes

Kubernetes would provide advanced orchestration, scaling, and deployment
features.

This was rejected as unnecessary for the project. The app does not need
multi-node orchestration, autoscaling, or cluster-level complexity for v1.

## Consequences

The repository should eventually include deployment configuration for the
Raspberry Pi Compose stack, likely under a dedicated deployment or infrastructure
folder.

The backend service must be container-friendly. Configuration should come from
environment variables, logs should go to standard output, and health checks
should be exposed through an HTTP endpoint.

The deployment plan must define persistent storage for PostgreSQL and uploaded
scorebooks. It must also document backup and restore steps before the app is
used for a live tournament.

Public access must support both HTTPS for normal API calls and WSS for
WebSocket live updates. The selected reverse proxy or tunnel must be configured
and tested for WebSocket traffic.

