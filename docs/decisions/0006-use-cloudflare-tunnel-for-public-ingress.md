# ADR 0006: Use Cloudflare Tunnel for Public Ingress

## Status

Accepted on August 16, 2026.

## Context

Ruski Report runs its production NestJS API, Socket.IO gateway, and PostgreSQL
database on a Raspberry Pi 5 in a residential homelab. The public iOS client
needs a stable HTTPS API and WSS realtime endpoint, but the deployment must not
publish PostgreSQL, SSH, Docker administration, or the API's host port to the
Internet. The homelab should not depend on an inbound router port forward or a
stable public residential IP address.

The public hostname is `api.ruskireport.com`. The domain uses Cloudflare DNS,
and the operator has created a remotely managed Cloudflare Tunnel for the
Miami homelab.

## Decision

Run the official `cloudflare/cloudflared` image as a service in the Raspberry
Pi Docker Compose project. Pin the image to a reviewed release rather than
using `latest`.

The connector authenticates with a tunnel token stored outside the repository
at `/opt/ruski-report/secrets/cloudflared.env`. Only the `cloudflared` service
loads that file. The token must not appear in Compose files, shell history,
logs, screenshots, or Git.

Attach `cloudflared` only to the `ruski-report-edge` Docker network. Publish the
Cloudflare application route as:

```text
api.ruskireport.com -> http://api:3000
```

The API remains attached to both the edge and internal database networks.
PostgreSQL remains attached only to the internal database network and has no
published host port. The API's diagnostic host binding remains
`127.0.0.1:3000`. SSH remains a LAN or WireGuard management service and is not
published through this tunnel.

Cloudflare terminates public TLS and forwards HTTP and WebSocket upgrade
traffic through outbound connections established by `cloudflared`. The
backend trusts exactly one proxy hop in production and restricts browser CORS
to the configured exact origins.

## Consequences

- The Brume 2 gateway does not need an inbound port-forwarding rule for the
  application.
- Cloudflare manages public DNS, TLS certificate renewal, and the tunnel edge.
- REST and Socket.IO traffic share one public HTTPS/WSS origin.
- Cloudflare may process client IP addresses and connection metadata, so the
  public privacy policy and internal data-handling record must name Cloudflare.
- Tunnel availability depends on the Pi's outbound Internet connection and
  Cloudflare's service. Docker restarts the connector after failures and host
  reboots.
- Anyone with the tunnel token can run a connector for this tunnel. A suspected
  disclosure requires token rotation in Cloudflare and replacement of the Pi
  secret file.
- The connector's metrics endpoint is confined to the Docker edge network and
  is not published on the Pi host.

## Alternatives Considered

### Direct Caddy or Nginx ingress

This would keep TLS termination inside the homelab, but it requires inbound
router configuration and exposes a residential origin address. It remains a
reasonable future option if the hosting environment changes.

### Tailscale Funnel

This provides a similarly simple outbound path, but Cloudflare Tunnel aligns
with the selected domain, DNS management, and public edge configuration.

### Cloud-hosted backend

This would remove residential-network dependencies, but it conflicts with the
selected Raspberry Pi deployment target and the project's homelab learning
goals.
