# Realtime Updates

Ruski Report uses a NestJS Socket.IO WebSocket gateway for live update
notifications. HTTP endpoints remain the source of truth for full tournament,
match, scorecard, and comment data.

## Connection

- Namespace: `/live`
- Socket.IO path: `/socket.io`
- Server event: `live.update`
- Client event: `subscribe`

On connection the server emits a `connection.ready` event. Clients subscribe by
sending one of these payloads:

```json
{ "scope": "all" }
```

```json
{ "scope": "tournament", "tournamentId": "tournament-2026" }
```

```json
{ "scope": "match", "tournamentId": "tournament-2026", "matchId": "match-1" }
```

The `all` scope is for views that need to refresh tournament lists or active
tournament summaries. Tournament and match scopes narrow updates for detail
screens.

## Events

Realtime payloads use the shared `LiveUpdateEvent` domain contract. Initial
event types are:

- `connection.ready`
- `tournament.updated`
- `match.updated`
- `comments.updated`
- `error`

Scorebook ingestion publishes `tournament.updated` after the backend stores a
valid tournament snapshot. Comment creation publishes `comments.updated` for
the match.

## Deployment Notes

The WebSocket endpoint should be exposed through the same public origin as the
HTTP API. Any tunnel, reverse proxy, or VPN-facing proxy in front of the
Raspberry Pi must forward HTTP upgrade traffic for Socket.IO. The default local
backend port is still `3000`.
