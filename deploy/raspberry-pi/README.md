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

Generate three different URL-safe secrets:

```bash
openssl rand -hex 32
openssl rand -hex 48
openssl rand -hex 48
```

Open `.env` in an editor and assign the first value to `POSTGRES_PASSWORD` and
the second to `ADMIN_API_TOKEN`. Assign the third to
`ADMIN_AUTH_SECURITY_SECRET`, and set `ADMIN_WEB_ORIGIN` to the canonical exact
HTTPS origin used to open the private administrator app. Do not place any
secret in shell history, source control, screenshots, the iOS app, or operator
documentation.

For the first deployment, set `RUSKI_API_IMAGE` to a local, immutable-purpose
tag such as `ruski-report-api:bootstrap-FULL_COMMIT_SHA`. Phase 7 updates use
the preparation workflow below instead of choosing this value by hand. Keep
`RUSKI_API_BIND_ADDRESS=127.0.0.1` except during the LAN acceptance test below.
Keep `CLOUDFLARED_ENV_FILE` outside the source directory. The production
defaults allow browser origins `https://ruskireport.com` and
`https://www.ruskireport.com`, trust the single `cloudflared` proxy hop, limit
parsed request bodies to 8 MiB with at most 7,000 URL-encoded fields for the
bounded advanced setup form, and limit scorebook files to 10 MiB.

Validate interpolation without printing the rendered configuration, which
would expose secrets:

```bash
docker compose --env-file .env config --quiet
```

## 5. Build and Start The First Deployment

This section is only for a host that has no prior Ruski Report API image to
preserve. Once an API is deployed, every release must use the build-once
workflow under **Deploy an Update**.

Build the ARM64 image from the lockfile:

```bash
docker compose --env-file .env build --pull api
```

Start the stack. Compose waits for PostgreSQL, runs migrations once, and starts
the API only after migrations succeed:

```bash
docker compose --env-file .env up -d --no-build
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

### Bootstrap the first administrator

After migrations and the API are healthy, create a temporary host directory
for the one-time credential. It must be owned by the invoking user and grant no
group or other permissions:

```bash
install -d -m 0700 /opt/ruski-report/operator-credentials
```

Run the production credential command inside the shipped API image so it can
reach PostgreSQL on the private Compose network. The bind mount is the only
writable credential location and the raw token is never printed:

```bash
docker compose --env-file .env run --rm --no-deps \
  --user "$(id -u):$(id -g)" \
  --volume /opt/ruski-report/operator-credentials:/run/ruski-admin-credentials \
  api node dist/database/admin-bootstrap.js bootstrap \
  --login-name tournament-admin \
  --display-name "Tournament Administrator" \
  --protected-output-root /run/ruski-admin-credentials \
  --token-output /run/ruski-admin-credentials/bootstrap.json
```

Open the mode-0600 host file, visit its non-secret `browserUrl`, and paste the
single-use token into the form. Delete the file after the token is consumed or
expires. To recover an existing administrator, use the same container and
mount command with:

```bash
api node dist/database/admin-bootstrap.js recover \
  --administrator-id 00000000-0000-0000-0000-000000000000 \
  --protected-output-root /run/ruski-admin-credentials \
  --token-output /run/ruski-admin-credentials/recovery.json
```

The abbreviated recovery block replaces the command beginning with `api` in
the full invocation above; retain `docker compose`, `--user`, and `--volume`.

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

Phase 7 builds the API image once, rehearses that exact image, and then reuses
it in production. Do not run `docker compose build` during rehearsal,
deployment, or rollback. The preparation command records only the candidate
commit, local image references, immutable Docker image IDs, and a timestamp.
It does not record the repository path, environment-file path, credentials, or
configuration values.

Before preparing an image, complete the local qualification gate, select the
exact reviewed full commit or tag, and leave the existing API container
running so its immutable image can be preserved for rollback. Fetch and check
out the candidate in detached mode:

```bash
cd /opt/ruski-report/source
git fetch --tags origin
candidate_ref=EXACT_TAG_OR_FULL_COMMIT
git checkout --detach "$candidate_ref"
candidate_commit=$(git rev-parse HEAD)
```

Create a protected state directory outside Git and prepare the candidate. The
script rejects a branch name, dirty worktree, candidate/HEAD mismatch, missing
running API, reused candidate tag, or invalid Docker image ID. It tags the
currently running API by its full immutable image ID before building the
candidate. Do not delete either tag during qualification or the production
observation window.

```bash
install -d -m 0700 /opt/ruski-report/release-images
release_state=/opt/ruski-report/release-images/${candidate_commit}.env
deploy/raspberry-pi/operations/prepare-release-image.sh prepare \
  "$candidate_ref" "$release_state"
```

Record the command's sanitized summary in release evidence. Keep the mode-0600
state file on the Pi, but do not record its path. It is the local verification
record, not a secret or a substitute for the release evidence summary.

Before and after every restored rehearsal step, verify that the tag still
resolves to the recorded image ID and revision label:

```bash
deploy/raspberry-pi/operations/prepare-release-image.sh verify "$release_state"
release_image=$(deploy/raspberry-pi/operations/prepare-release-image.sh \
  release-ref "$release_state")
export RUSKI_API_IMAGE="$release_image"
```

Supply this exported value to the isolated restored-database Compose project.
Its API and migration services must use this repository's `compose.yml`, must
start with `--no-build`, and must not point at the production PostgreSQL data
path. After starting its API, prove the running container uses the recorded
image ID:

```bash
deploy/raspberry-pi/operations/prepare-release-image.sh verify-container \
  release "$release_state" REHEARSAL_API_CONTAINER
```

Do not proceed until the restored migration, deterministic backfill,
equivalence, lifecycle, and rollback gates pass. The ordinary backup
`restore-rehearsal.sh` checks backup readability only; it does not replace the
Phase 7 candidate rehearsal.

Inside the explicitly authorized maintenance window, verify the state again,
then edit only `RUSKI_API_IMAGE` in `.env` to the verified `release_image`.
Run the migration service from the already-built image and recreate the stack
without building. Stop after the migration command and complete the authorized
production backfill dry-run/apply/no-op sequence from the Phase 7 rollout
runbook. Start the candidate API only after those checks pass:

```bash
cd /opt/ruski-report/source/deploy/raspberry-pi
operations/prepare-release-image.sh verify "$release_state"
docker compose --env-file .env run --rm --no-deps migrate
```

After the backfill gate passes:

```bash
docker compose --env-file .env up -d --no-build --no-deps \
  --force-recreate api
docker compose --env-file .env ps --all
api_container=$(docker compose --env-file .env ps -q api)
operations/prepare-release-image.sh verify-container \
  release "$release_state" "$api_container"
```

Migration execution is serialized by a PostgreSQL advisory lock and runs in a
transaction. Application startup never mutates the schema implicitly. A
missing prepared image now fails locally because Compose never pulls an API
image; it must not be repaired by rebuilding during the release window.

## Restart and Inspect

```bash
docker compose --env-file .env restart api
docker compose --env-file .env logs --since 30m api
docker compose --env-file .env ps --all
```

Do not use `docker compose down --volumes`; it removes persistent database
storage.

## Code Rollback

The preparation workflow retains the previously running image under a tag that
contains its full immutable image ID. If a rollback trigger fires, obtain and
verify that reference before changing the checkout. Set `RUSKI_API_IMAGE` in
`.env` to the printed value, then recreate the API without a build:

```bash
rollback_image=$(operations/prepare-release-image.sh rollback-ref \
  "$release_state")
operations/prepare-release-image.sh verify "$release_state"
sudoedit .env
docker compose --env-file .env up -d --no-build --no-deps \
  --force-recreate api
api_container=$(docker compose --env-file .env ps -q api)
operations/prepare-release-image.sh verify-container \
  rollback "$release_state" "$api_container"
curl --fail --show-error http://127.0.0.1:3000/api/health
```

Enter the printed `rollback_image` as the new `.env` value; do not paste the
state-file path or its contents into evidence. Do not reverse or delete
database migrations manually. For the first canonical migration, or whenever
schema compatibility is not already proven, restore the final pre-window
backup into a newly created database before starting the preserved image, as
required by the Phase 7 rollout runbook.

## Issue 35 Acceptance Record

Record these results in issue 35 before closing it:

- Exact Git commit, `RUSKI_API_IMAGE`, and immutable Docker image ID.
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
