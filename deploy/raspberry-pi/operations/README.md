# Raspberry Pi Backup Operations

These files implement the Pi half of ADR 0007. The scheduled job makes a
consistent PostgreSQL dump, stages deployment configuration and operator source
workbooks, encrypts the snapshot with restic, and uploads it to the private S3
repository. The staging directory is outside the live PostgreSQL data path.

## Backup Contents

Each snapshot contains:

- `database.dump`, a PostgreSQL custom-format logical dump.
- `database-contents.txt`, the dump catalog used as an early validity check.
- The Compose `.env` and Cloudflare environment file, encrypted inside restic.
- Files copied by the operator into `/srv/ruski-report/source-workbooks`.
- A non-secret deployment manifest containing timestamp, host, commit, and
  container-image information.

The restic password and AWS credentials are never included in the snapshot. An
offline copy of the restic password is essential: S3 and AWS support cannot
decrypt a restic repository without it.

## 1. Install And Stage The Files

Change into the deployment directory in the checked-out repository on the Pi:

```bash
cd /opt/ruski-report/source/deploy/raspberry-pi
```

Then install the package and create the protected host directories:

```bash
sudo apt update
sudo apt install -y restic
sudo install -d -o root -g clbemi -m 0750 /opt/ruski-report/secrets
sudo install -d -o root -g root -m 0700 /var/lib/ruski-report-backup
sudo install -d -o root -g root -m 0700 /var/cache/ruski-report-restic
sudo install -d -o clbemi -g clbemi -m 0750 /srv/ruski-report/source-workbooks
sudo install -d -o root -g root -m 0750 /usr/local/lib/ruski-report
```

```bash
sudo install -o root -g root -m 0750 operations/backup.sh /usr/local/lib/ruski-report/backup.sh
sudo install -o root -g root -m 0750 operations/check-backup.sh /usr/local/lib/ruski-report/check-backup.sh
sudo install -o root -g root -m 0750 operations/configure-backup-secrets.sh /usr/local/lib/ruski-report/configure-backup-secrets.sh
sudo install -o root -g root -m 0750 operations/restore-rehearsal.sh /usr/local/lib/ruski-report/restore-rehearsal.sh
sudo install -o root -g root -m 0644 operations/systemd/* /etc/systemd/system/
sudo install -D -o root -g root -m 0644 \
  operations/journald.conf.d/60-ruski-report.conf \
  /etc/systemd/journald.conf.d/60-ruski-report.conf
```

Apply the persistent 30-day journal limit. Restarting journald does not stop
Docker, SSH, or the application containers:

```bash
sudo systemctl restart systemd-journald
systemd-analyze cat-config systemd/journald.conf \
  | grep -E '^(Storage|SystemMaxUse|RuntimeMaxUse|MaxRetentionSec)='
sudo journalctl --disk-usage
```

Compose sends every container's standard output and error to journald. The same
30-day/256 MiB journal limit therefore covers application containers,
backup/check services, and other host services in one enforceable retention
boundary.

## 2. Store Secrets

Use the interactive configuration helper immediately after AWS displays the
dedicated IAM access key. It asks for the non-secret CloudFormation repository
output and access-key ID, hides the secret-access-key input, generates a
separate restic password, and writes both files with mode `0600`:

```bash
sudo /usr/local/lib/ruski-report/configure-backup-secrets.sh
```

The helper prints the generated restic password once. Save it immediately in a
password manager; it is not an AWS password, and neither AWS nor S3 can recover
it. The helper refuses to overwrite existing secret files.

Do not use a root-user key or a personal administrator key. Verify permissions
without printing either file:

```bash
sudo stat -c '%A %U:%G %n' /opt/ruski-report/secrets/restic.env /opt/ruski-report/secrets/restic-password
```

Both lines must begin with `-rw------- root:root`.

The parent directory is `root:clbemi` mode `0750` so Compose can traverse it
to the separately group-readable Cloudflare file. The AWS/restic files remain
unreadable to the group.

Copy the canonical operator workbook into the included source directory. The
API intentionally does not retain upload request bytes:

```bash
cp /path/to/current-ruski-scorebook.xlsx /srv/ruski-report/source-workbooks/
```

## 3. Initialize And Test

Reload systemd, initialize the encrypted repository exactly once, and run the
first backup:

```bash
sudo systemctl daemon-reload
sudo systemctl start ruski-report-backup-init.service
sudo systemctl start ruski-report-backup.service
```

Check success without exposing secrets:

```bash
sudo systemctl status ruski-report-backup.service --no-pager
sudo journalctl -u ruski-report-backup.service -n 100 --no-pager
```

Run the integrity check:

```bash
sudo systemctl start ruski-report-backup-check.service
```

For the clean restore rehearsal, load the root-only environment in a temporary
root shell rather than exporting credentials through the unprivileged account:

```bash
sudo -i
set -a
source /opt/ruski-report/secrets/restic.env
set +a
/usr/local/lib/ruski-report/restore-rehearsal.sh
exit
```

The rehearsal restores into temporary containers and reads a restored
tournament through `GET /api/tournaments/:id` across the private Docker
database network. It does not publish another host port or stop, alter, or
overwrite production PostgreSQL.

## 4. Enable Automation

Enable the hourly backup and weekly integrity check only after all three manual
tests succeed:

```bash
sudo systemctl enable --now ruski-report-backup.timer
sudo systemctl enable --now ruski-report-backup-check.timer
systemctl list-timers 'ruski-report-backup*'
```

`Persistent=true` causes a missed job to run after the Pi returns online. A
shared lock prevents a backup, prune, integrity check, and restore rehearsal
from changing the repository concurrently.

The retention command groups snapshots by host and tags rather than by the
temporary staging path. Keep that explicit grouping: every backup uses a unique
run directory, and path-based groups would prevent the 27-day window from
expiring older snapshots.

## Routine Verification

The normal recovery point is the most recent successful hourly snapshot. Run
the clean restore rehearsal monthly, before each tournament, after changing the
backup process, and after rotating either AWS or restic credentials.

Use these checks without printing secret files:

```bash
systemctl list-timers 'ruski-report-backup*'
sudo systemctl status ruski-report-backup.service --no-pager
sudo systemctl status ruski-report-backup-check.service --no-pager
sudo journalctl -u ruski-report-backup.service --since -2h --no-pager
sudo journalctl -u ruski-report-backup-check.service --since -8d --no-pager
```

```bash
cd /opt/ruski-report/source/deploy/raspberry-pi
docker compose --env-file .env ps --all
docker inspect ruski-report-postgres-1 ruski-report-api-1 ruski-report-cloudflared-1 \
  --format '{{.Name}} {{.HostConfig.LogConfig.Type}}'
sudo journalctl --disk-usage
```

Each container must use Docker's `journald` driver. The journal configuration
must show persistent storage, a 256 MiB system cap, and a 30-day maximum age.

## Availability Alert Response

An AWS email alarm means the external monitor could not complete public HTTPS,
database readiness, and two WSS connections, or the scheduled monitor itself
has not run in 15 minutes. Start an incident note with the alarm name, state
change time, and responder. Do not copy user data or secret-bearing environment
output into that note.

From a network outside the Miami homelab, establish whether the failure is
still present:

```bash
curl --fail --show-error https://api.ruskireport.com/api/health
cd backend
npm run smoke:realtime -- https://api.ruskireport.com
```

If either check fails, connect to the Pi through the LAN or WireGuard path and
inspect the components from the outside inward:

```bash
date -u
cd /opt/ruski-report/source/deploy/raspberry-pi
docker compose --env-file .env ps --all
systemctl --failed
sudo systemctl status docker --no-pager
docker compose --env-file .env logs --since 30m postgres api cloudflared
```

- An unhealthy `postgres` container is a database incident. Preserve its logs
  and data directory, try a normal container restart once, and use the clean
  restore procedure below if it does not recover.
- An unhealthy `api` with healthy PostgreSQL is an application incident. Use
  the code rollback in the main Pi runbook if the failure followed a deploy.
- Healthy API and PostgreSQL with a failed `cloudflared` container is an ingress
  incident. Restart only `cloudflared`, then inspect the Cloudflare tunnel
  dashboard before considering token rotation.
- Healthy Pi checks with a failed AWS test can be a transient public-network or
  AWS monitor problem. Run the Lambda healthy test, inspect its 30-day
  CloudWatch log group, and do not restart production without evidence.

After recovery, repeat public HTTPS and WSS tests, wait for the CloudWatch alarm
to return to `OK`, and record the root cause, action, start/end times, and any
follow-up issue. If user-visible writes may have been lost, record the last
successful backup time and communicate the recovery point.

## Clean Production Database Restore

The rehearsal script above is always the first restore step. A production
cutover is intentionally manual because it changes the database path and
creates downtime. Use a maintenance window and a second operator review when
possible. Never restore over the current PostgreSQL directory.

Before downtime, record the selected snapshot and current deployed commit, run
a fresh backup if the database is readable, and run the isolated rehearsal:

```bash
sudo systemctl start ruski-report-backup.service
sudo systemctl status ruski-report-backup.service --no-pager
sudo -i
set -a
source /opt/ruski-report/secrets/restic.env
set +a
restic snapshots --host ruski-pi --tag ruski-report --latest 5
/usr/local/lib/ruski-report/restore-rehearsal.sh SNAPSHOT_ID
```

Still in the root shell, restore the selected snapshot into a protected staging
directory and locate its dump:

```bash
restore_root=/var/lib/ruski-report-backup/production-restore
install -d -o root -g root -m 0700 "$restore_root"
restic restore SNAPSHOT_ID --host ruski-pi --tag ruski-report --target "$restore_root"
find "$restore_root" -type f -name database.dump -print
```

Use the single path printed by `find` as `DUMP_FILE` below. Preserve a protected
copy of the current Compose configuration for immediate rollback, then stop the
public write path and database:

```bash
cd /opt/ruski-report/source/deploy/raspberry-pi
install -o root -g root -m 0600 .env /opt/ruski-report/secrets/compose.env.before-restore
docker compose --env-file .env stop cloudflared api postgres
```

Create a new empty host directory such as
`/srv/ruski-report/postgres-restore-YYYYMMDDTHHMMSSZ`. Edit only
`RUSKI_POSTGRES_DATA_PATH` in `.env` to that exact path, then initialize the
clean PostgreSQL instance using the existing Compose credentials:

```bash
install -d -o root -g root -m 0750 /srv/ruski-report/postgres-restore-YYYYMMDDTHHMMSSZ
sudoedit .env
docker compose --env-file .env up -d postgres
docker compose --env-file .env ps postgres
```

Wait until PostgreSQL reports `healthy`, then restore the dump. The redirection
is performed by the root shell; it does not expose credentials:

```bash
docker compose --env-file .env exec -T postgres sh -ceu 'pg_restore --exit-on-error --no-owner --no-acl --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"' < DUMP_FILE
docker compose --env-file .env run --rm migrate
docker compose --env-file .env up -d --no-deps api
curl --fail --show-error http://127.0.0.1:3000/api/health
```

Read at least one restored tournament by its recorded ID while `cloudflared`
is still stopped. Only then restore public ingress and run both external tests:

```bash
curl --fail --show-error http://127.0.0.1:3000/api/tournaments/TOURNAMENT_ID
docker compose --env-file .env up -d --no-deps cloudflared
curl --fail --show-error https://api.ruskireport.com/api/health
cd /opt/ruski-report/source/backend
npm run smoke:realtime -- https://api.ruskireport.com
```

If verification fails before ingress is restored, stop the new containers,
copy `/opt/ruski-report/secrets/compose.env.before-restore` back to `.env`, and
start the original stack. Do not delete either PostgreSQL directory while an
incident is active. After a successful cutover and observation window, remove
the protected environment copy and retire the exact old data directory within
30 days; verify both paths before any deletion.

## Manual Source Workbook Recovery

If PostgreSQL is healthy and only the canonical workbook is missing, do not
replace the database. Restore the selected snapshot into a temporary protected
directory, locate the workbook under `source-workbooks`, and copy it back to the
canonical source directory:

```bash
sudo -i
set -a
source /opt/ruski-report/secrets/restic.env
set +a
workbook_restore=/var/lib/ruski-report-backup/workbook-restore
install -d -o root -g root -m 0700 "$workbook_restore"
restic restore SNAPSHOT_ID --host ruski-pi --tag ruski-report --target "$workbook_restore"
find "$workbook_restore" -type f -path '*/source-workbooks/*' -print
```

Copy the intended `.xlsx` file into `/srv/ruski-report/source-workbooks`, set
ownership to `clbemi:clbemi` and mode `0640`, then repeat the normal authorized
scorebook upload. Treat the upload response as a new publication: verify its
tournament ID through the public API and WSS smoke test. Never edit normalized
PostgreSQL rows to simulate a workbook import.

## Credential Rotation

For AWS rotation, create a second access key for
`ruski-report-pi-backup`, paste it into the root-only `restic.env` using
`sudoedit`, and run `restic snapshots`, a backup, and the restore rehearsal.
Only after all three pass should the previous key be deactivated and deleted in
IAM. Never leave two active keys after the validation window.

Changing the restic password requires a repository-wide `restic key passwd`
operation and updating the password-manager copy. Test a clean restore before
removing the old repository key. Losing every valid restic password makes the
S3 data permanently unreadable.

## Issue 37 Acceptance Record

Record the following non-secret evidence in issue 37:

- CloudFormation `UPDATE_COMPLETE`, confirmed SNS subscription, healthy Lambda
  result, controlled alarm email, and recovery email.
- Exact deployed Git commit and the public health response confirming database
  readiness.
- WSS initial connection and reconnection success.
- Hourly timer result and latest snapshot ID/time, weekly repository check, and
  isolated restore rehearsal tournament/API result.
- The canonical workbook's presence in the snapshot without publishing its
  content or checksum.
- Docker log-driver limits, journald cap/retention, and all service health
  states.

Never paste environment files, passwords, access keys, tokens, alarm email
links, restored user data, or full logs containing request metadata.
