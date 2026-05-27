# ADR 0003: Use WebSockets for Live Updates

## Status

Accepted

## Context

Ruski Report needs live tournament and match updates so users can follow active
games without manually refreshing the app. The backend will ingest official
scorebook updates, normalize tournament state, store the latest snapshot, and
notify connected clients when visible data changes.

Version 1 is viewing-first, so most realtime traffic will initially be
server-to-client updates. However, the product roadmap includes future in-app
scoring, match comments, authenticated users, and admin workflows. Those future
features are more interactive and benefit from a bidirectional realtime
transport.

The backend framework decision in ADR 0002 selected NestJS. NestJS has first
class support for WebSocket gateways, which gives the project a structured way
to implement realtime events while keeping the rest of the API organized around
controllers and services.

## Decision

Use WebSockets as the primary realtime transport for Ruski Report live updates.

The backend will expose a WebSocket gateway for tournament and match update
events. Clients will subscribe to relevant tournament or match streams and
receive events when the backend publishes a new tournament snapshot, match
state, scorecard update, or comment-related update.

Standard HTTP endpoints will still be used for normal reads and writes. The
WebSocket connection is used to notify clients that data changed and to deliver
small realtime event payloads. Clients can then update local state directly from
the event or fetch the latest API resource when a full refresh is safer.

## Rationale

WebSockets are more complex than Server-Sent Events, but they better match the
long-term product direction. Ruski Report is expected to grow from passive
tournament viewing into a system that may support in-app scoring, admin
workflows, match comments, and richer live match interactions.

Choosing WebSockets now gives the backend one realtime foundation that can
support both current viewing updates and future bidirectional workflows.

This decision also supports the resume-quality goal of the project. A well-built
WebSocket gateway demonstrates connection lifecycle handling, event design,
authentication strategy, room/subscription modeling, logging, and integration
with the ingestion pipeline.

## Event Model

The WebSocket layer should use explicit event names instead of sending
unstructured messages. Initial event types should include:

- `tournament.updated`: A tournament snapshot or summary changed.
- `match.updated`: A match detail, score, scorecard, or phase changed.
- `comments.updated`: A match comment list changed.
- `connection.ready`: The client connected and can subscribe.
- `error`: The server rejected a subscription or event.

Events should include enough metadata for the iOS app to decide whether to
refresh visible data:

```json
{
  "type": "match.updated",
  "tournamentId": "2026-ruski",
  "matchId": "match-id",
  "version": 12,
  "occurredAt": "2026-05-27T12:00:00Z"
}
```

## Alternatives Considered

### Server-Sent Events

Server-Sent Events are simpler for one-way server-to-client updates. They would
be a strong fit for a purely viewing-first v1 because the backend mostly needs
to tell clients that tournament or match data changed.

SSE was not selected because it does not support bidirectional communication on
the same connection. Future in-app scoring and richer live match interactions
would likely require either adding WebSockets later or running two realtime
patterns in parallel.

### Polling

Polling would have the iOS app request tournament or match data every few
seconds.

Polling was not selected as the primary realtime strategy because it is not
truly live, creates unnecessary requests when no data changes, and feels less
polished during active games. Polling may still be useful as a fallback if a
WebSocket connection cannot be established.

### Push Notifications

Push notifications are useful for alerting users when they are not actively in
the app.

Push notifications were not selected as the live update transport because they
do not provide an in-app realtime score stream. They may be added later for
major events such as game start, final score, or championship updates.

### Hosted Realtime Service

Services such as Firebase, Supabase Realtime, Ably, or Pusher can manage
realtime connections externally.

A hosted realtime service was not selected because Ruski Report already needs a
custom backend for scorebook ingestion, validation, normalization, and admin
workflows. Keeping realtime inside the NestJS backend avoids another core
runtime dependency and better demonstrates the backend architecture.

## Consequences

The backend foundation should include a NestJS WebSocket gateway once realtime
work begins. The gateway should stay thin and delegate business logic to
services, just like HTTP controllers.

The backend must handle connection lifecycle events, subscription state,
disconnects, reconnects, logging, and error messages. It should also define an
authentication path before WebSockets are used for privileged actions such as
admin scoring or authenticated comments.

The iOS app will need a WebSocket client abstraction in the data layer. Views
should not talk to sockets directly. Controllers or repositories should consume
typed realtime events and decide when visible tournament or match data should be
refreshed.

Because WebSockets add complexity, the app should retain a simple refresh path
through HTTP APIs. A polling or manual refresh fallback should be available if
the realtime connection is unavailable.

