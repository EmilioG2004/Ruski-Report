# Raspberry Pi Deployment Runbook

This runbook implements ADR 0005 for the production NestJS and PostgreSQL
runtime. Public HTTPS/WSS, automated backups, monitoring, and the iOS production
URL are tracked separately by GitHub issues 36, 37, and 38.

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

The API port binds to `127.0.0.1` by default. Issue 36 will attach the public
HTTPS/WSS edge to the `ruski-report-edge` Docker network. The database remains
on a separate internal network.

Uploaded workbook bytes are processed from the request buffer and are not
retained on the Pi. PostgreSQL stores normalized tournament data, source
metadata, checksums, validation results, and publication history. Preserve the
canonical workbook through the operator Mac's normal backup process.

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
docker compose --env-file .env logs --since 10m postgres migrate api
```

Verify the loopback health endpoint on the Pi:

```bash
curl --fail --show-error http://127.0.0.1:3000/api/health
```

The expected response is:

```json
{"status":"ok","service":"ruski-report-backend"}
```

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

`GET /api/tournaments/active` returns a tournament only while its normalized
status is `active`; a completed workbook correctly returns `404` there.

Confirm that PostgreSQL is not reachable from the LAN:

```bash
nc -vz 192.168.8.129 5432
```

That command must fail. Restore `RUSKI_API_BIND_ADDRESS=127.0.0.1` and recreate
the API before beginning issue 36:

```bash
docker compose --env-file .env up -d --no-deps --force-recreate api
```

## 7. Recovery Verification

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
