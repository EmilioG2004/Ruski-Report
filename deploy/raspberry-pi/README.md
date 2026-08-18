# Raspberry Pi Deployment Runbook

This runbook implements ADRs 0005 and 0006 for the production NestJS,
PostgreSQL, and Cloudflare Tunnel runtime. The encrypted AWS S3 backup and
restore procedure from ADR 0007 lives in
[`operations/README.md`](operations/README.md). AWS Lambda and CloudWatch
monitor the public production path as documented in
[`../aws/README.md`](../aws/README.md). The iOS production URL remains tracked
by GitHub issue 38.

## Target Host

The first deployment target was verified on August 13, 2026:

- Raspberry Pi 5 Model B Rev 1.1
- ARM64 (`aarch64`)
- 8 GB RAM
- Debian 13 (Trixie)
- Ethernet address `192.168.8.129/24`
- 128 GB microSD card

The microSD card is suitable for bring-up and LAN testing. Move Docker's
persistent PostgreSQL storage to a USB 3 SSD before using the service for a live
tournament. Reserve the Pi's address in the Brume 2 DHCP configuration rather
than configuring an unrelated static address inside Debian.

## Runtime Layout

The production Compose project contains:

- `postgres`: PostgreSQL with a persistent host path and no published port.
- `migrate`: a one-shot copy of the API image that applies transactional,
  advisory-locked migrations before the API starts.
- `api`: the compiled NestJS process, running as the unprivileged `node` user.
- `cloudflared`: the outbound-only public edge connector for
  `api.ruskireport.com`.

The API port binds to `127.0.0.1` by default. Cloudflare Tunnel attaches the
public HTTPS/WSS edge to the `ruski-report-edge` Docker network. `cloudflared`
joins only that edge network and reaches the backend at `http://api:3000`.
The database remains on a separate internal network with no published port.

Uploaded workbook bytes are processed from the request buffer and are not
retained on the Pi. PostgreSQL stores normalized tournament data, source
metadata, checksums, validation results, and publication history. Preserve the
canonical workbook on the operator Mac and copy it into
`/srv/ruski-report/source-workbooks` so the encrypted hourly S3 snapshot covers
both recovery sources.

## 1. Prepare Debian

Update the operating system, reboot, and reconnect:

```bash
sudo apt update
sudo apt full-upgrade -y
sudo reboot
```

After reconnecting, install Docker Engine and the Compose plugin from Docker's
official Debian repository:

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
```

```bash
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
```

Allow the deployment account to operate Docker, then disconnect and reconnect
so the new group takes effect:

```bash
sudo usermod -aG docker clbemi
```

Membership in the `docker` group grants root-equivalent control of the host.
Do not grant it to public or application accounts.

Verify the installation and boot configuration:

```bash
docker version
docker compose version
systemctl is-enabled docker
systemctl is-active docker
```

## 2. Create Host Storage

The default data directory is deliberately outside the Git checkout:

```bash
sudo install -d -m 0750 /srv/ruski-report
sudo install -d -m 0750 /srv/ruski-report/postgres
```

The official PostgreSQL entrypoint initializes and assigns its internal data
directory on first start. Do not manually edit files below this path.

When an SSD is added, mount it persistently and set
`RUSKI_POSTGRES_DATA_PATH` to a directory on that mount. Move the database only
through the backup-and-restore procedure delivered by issue 37.

## 3. Check Out an Exact Release

Install Git if necessary and clone the repository:

```bash
sudo apt install -y git
sudo install -d -o clbemi -g clbemi -m 0750 /opt/ruski-report
git clone https://github.com/EmilioG2004/Ruski-Report.git \
  /opt/ruski-report/source
cd /opt/ruski-report/source
```

Deploy a reviewed tag or full commit SHA. Do not deploy an unspecified moving
branch for a live tournament:

```bash
git fetch --tags origin
git checkout --detach DEPLOYED_TAG_OR_COMMIT
git rev-parse HEAD
```

## 4. Configure Runtime Secrets

Create the untracked deployment environment file:

```bash
cd /opt/ruski-report/source/deploy/raspberry-pi
cp .env.example .env
chmod 600 .env
```

Create a separate connector secret outside the Git checkout. If this file was
already created during tunnel provisioning, do not replace it:

```bash
sudo install -d -o clbemi -g clbemi -m 0700 /opt/ruski-report/secrets
```

For a new or rotated token, run the following command exactly, then paste the
token only at the hidden prompt and press Return:

```bash
read -rsp "Paste Cloudflare tunnel token: " RUSKI_TUNNEL_TOKEN; echo
```

Store it without placing the value in shell history:

```bash
umask 077
printf 'TUNNEL_TOKEN=%s\n' "$RUSKI_TUNNEL_TOKEN" > /opt/ruski-report/secrets/cloudflared.env
unset RUSKI_TUNNEL_TOKEN
chmod 600 /opt/ruski-report/secrets/cloudflared.env
sudo chown root:clbemi /opt/ruski-report/secrets
sudo chown root:clbemi /opt/ruski-report/secrets/cloudflared.env
sudo chmod 750 /opt/ruski-report/secrets
sudo chmod 640 /opt/ruski-report/secrets/cloudflared.env
```

Verify the token prefix without printing the credential:

```bash
grep -q '^TUNNEL_TOKEN=eyJ' /opt/ruski-report/secrets/cloudflared.env && echo OK
```

Generate two different URL-safe secrets:

```bash
openssl rand -hex 32
openssl rand -hex 48
```

Open `.env` in an editor and assign the first value to `POSTGRES_PASSWORD` and
the second to `ADMIN_API_TOKEN`. Do not place either value in shell history,
source control, screenshots, the iOS app, or operator documentation.

Set `RUSKI_IMAGE_TAG` to the checked-out tag or short commit SHA. Keep
`RUSKI_API_BIND_ADDRESS=127.0.0.1` except during the LAN acceptance test below.
Keep `CLOUDFLARED_ENV_FILE` outside the source directory. The production
defaults allow browser origins `https://ruskireport.com` and
`https://www.ruskireport.com`, trust the single `cloudflared` proxy hop, limit
normal request bodies to 256 KiB, and limit scorebook files to 10 MiB.

Validate interpolation without printing the rendered configuration, which
would expose secrets:

```bash
docker compose --env-file .env config --quiet
```

## 5. Build and Start

Build the ARM64 image from the lockfile:

```bash
docker compose --env-file .env build --pull
```

Start the stack. Compose waits for PostgreSQL, runs migrations once, and starts
the API only after migrations succeed:

```bash
docker compose --env-file .env up -d
docker compose --env-file .env ps --all
```

Inspect startup without disclosing the `.env` file:

```bash
docker compose --env-file .env logs --since 10m postgres migrate api cloudflared
```

Verify the loopback health endpoint on the Pi:

```bash
curl --fail --show-error http://127.0.0.1:3000/api/health
```

The expected response is:

```json
{"status":"ok","service":"ruski-report-backend","database":"ok"}
```

The route performs a PostgreSQL `SELECT 1`. A non-200 response therefore means
that either the API process or its database dependency is not ready.

## 6. LAN Acceptance Test

Temporarily change this value in `.env`:

```text
RUSKI_API_BIND_ADDRESS=192.168.8.129
```

Recreate only the API port binding:

```bash
docker compose --env-file .env up -d --no-deps --force-recreate api
```

From another machine on the homelab LAN, verify health and the public game
definition endpoint:

```bash
curl --fail --show-error http://192.168.8.129:3000/api/health
curl --fail --show-error http://192.168.8.129:3000/api/games
```

After publishing the official workbook, use the `tournamentId` returned by the
upload response to verify a public tournament read:

```bash
curl --fail --show-error \
  http://192.168.8.129:3000/api/tournaments/TOURNAMENT_ID
```

`GET /api/tournaments/active` returns the newest active published snapshot.
The response retains its normalized `scheduled`, `active`, or `completed`
status so clients can distinguish a live event from final tournament results.

Confirm that PostgreSQL is not reachable from the LAN:

```bash
nc -vz 192.168.8.129 5432
```

That command must fail. Restore `RUSKI_API_BIND_ADDRESS=127.0.0.1` and recreate
the API before starting the public connector:

```bash
docker compose --env-file .env up -d --no-deps --force-recreate api
```

## 7. Publish the Cloudflare Route

Before adding the public route, verify the connector is running:

```bash
docker compose --env-file .env ps cloudflared
docker compose --env-file .env logs --since 5m cloudflared
```

The logs should show registered tunnel connections, and the Cloudflare
dashboard should show the tunnel as `Healthy`. The token value must not appear
in the logs.

In the Cloudflare dashboard:

1. Go to **Networking > Tunnels** and select the existing Ruski Report tunnel.
2. Open **Routes**, then select **Add route > Published application**.
3. Set the hostname to `api.ruskireport.com`.
4. Set the service URL to `http://api:3000`.
5. Leave the path empty and save the route.

Do not use `localhost`, the Pi's LAN address, or the loopback host binding as
the service URL. `api` is Docker's internal DNS name for the backend container.
Cloudflare creates the public DNS record and terminates TLS; the origin hop
stays inside the Docker edge network.

From a device outside the homelab network, verify HTTPS:

```bash
curl --fail --show-error https://api.ruskireport.com/api/health
curl --fail --show-error https://api.ruskireport.com/api/games
```

From a machine with Node.js 22 or newer, verify two WSS connections:

```bash
cd backend
npm run smoke:realtime -- https://api.ruskireport.com
```

Before accepting the deployment, also exercise a production account login,
comment post, tournament read, and authorized scorebook upload. Confirm the Pi
still shows only the loopback API binding and no PostgreSQL host port:

```bash
docker compose --env-file .env ps --all
sudo ss -ltnp | grep -E ':(3000|5432)\b' || true
```

The Compose output should show `127.0.0.1:3000->3000/tcp` for the API and no
published PostgreSQL port. SSH remains a LAN or WireGuard service; do not add
it as a Cloudflare published application.

## 8. Recovery Verification

Verify automatic API crash recovery:

```bash
api_container_id=$(docker compose --env-file .env ps -q api)
api_host_pid=$(docker inspect --format '{{.State.Pid}}' "$api_container_id")
test "$api_host_pid" -gt 1
sudo kill -KILL "$api_host_pid"
sleep 10
docker compose --env-file .env ps api
curl --fail --show-error http://127.0.0.1:3000/api/health
```

The API should return to `healthy` and its Docker restart count should increase
because its restart policy is `unless-stopped`.
Do not use `docker compose stop` or `docker compose kill` for this check:
Docker treats those as intentional operator stops and suppresses automatic
restart.

Verify host-reboot recovery:

```bash
sudo reboot
```

After reconnecting:

```bash
cd /opt/ruski-report/source/deploy/raspberry-pi
docker compose --env-file .env ps --all
curl --fail --show-error http://127.0.0.1:3000/api/health
```

Verify connector recovery and then repeat the public health and WSS checks:

```bash
docker compose --env-file .env restart cloudflared
docker compose --env-file .env logs --since 5m cloudflared
curl --fail --show-error https://api.ruskireport.com/api/health
```

To rotate the tunnel token, use **Networking > Tunnels > select tunnel >
Refresh token** in Cloudflare. Copy only the new `eyJ...` value. Because the
production secrets directory is root-owned after initial setup, enter a root
shell and repeat the hidden prompt and `printf` commands from section 4. Then
restore `root:clbemi` ownership and mode `0640` on `cloudflared.env`, exit the
root shell, and recreate only the connector:

```bash
docker compose --env-file .env up -d --no-deps --force-recreate cloudflared
```

## Deploy an Update

Before a live deployment, complete the backup gate from issue 37. Then fetch
and check out the reviewed release:

```bash
cd /opt/ruski-report/source
git fetch --tags origin
git checkout --detach NEW_TAG_OR_COMMIT
git rev-parse HEAD
```

Update `RUSKI_IMAGE_TAG` in `deploy/raspberry-pi/.env`, then build, migrate, and
recreate the services:

```bash
cd deploy/raspberry-pi
docker compose --env-file .env build --pull
docker compose --env-file .env run --rm migrate
docker compose --env-file .env up -d --remove-orphans
docker compose --env-file .env ps --all
```

Migration execution is serialized by a PostgreSQL advisory lock and runs in a
transaction. Application startup never mutates the schema implicitly.

## Restart and Inspect

```bash
docker compose --env-file .env restart api
docker compose --env-file .env logs --since 30m api
docker compose --env-file .env ps --all
```

Do not use `docker compose down --volumes`; it removes persistent database
storage.

## Code Rollback

Record the currently deployed commit before every update. If the new release is
unhealthy and its migrations are backward-compatible, check out the preceding
release, restore its image tag in `.env`, rebuild, and recreate the API:

```bash
cd /opt/ruski-report/source
git checkout --detach PREVIOUS_TAG_OR_COMMIT
cd deploy/raspberry-pi
docker compose --env-file .env build
docker compose --env-file .env up -d --no-deps --force-recreate api
curl --fail --show-error http://127.0.0.1:3000/api/health
```

Do not reverse or delete database migrations manually. If a release introduces
a schema change that is not backward-compatible, stop and use the documented
database restore procedure from issue 37 instead of attempting code-only
rollback.

## Issue 35 Acceptance Record

Record these results in issue 35 before closing it:

- Exact Git commit and `RUSKI_IMAGE_TAG`.
- `docker compose config --quiet` success.
- ARM64 image build success.
- Migration and container health output.
- Health and `/api/games` response from another LAN machine.
- Confirmation that LAN port 5432 is closed.
- API crash-recovery result.
- Pi reboot-recovery result.
- The rollback commit used for the rehearsal.

## Issue 36 Acceptance Record

Record these results in issue 36 before closing it:

- Exact deployed Git commit and pinned `cloudflared` version.
- Cloudflare tunnel `Healthy` status and registered-connection log evidence.
- `https://api.ruskireport.com/api/health` and public API smoke-test results.
- WSS initial connection and reconnection result.
- Account login, comment posting, tournament read, and scorebook-upload result.
- Confirmation that PostgreSQL, port 3000, SSH, and Docker administration are
  not publicly exposed.
- Connector restart and Pi reboot-recovery results.
- Date the public privacy policy was updated to identify Cloudflare.
