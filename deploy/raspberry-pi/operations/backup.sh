#!/usr/bin/env bash
set -Eeuo pipefail

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE is required}"

compose_dir=${RUSKI_COMPOSE_DIR:-/opt/ruski-report/source/deploy/raspberry-pi}
compose_env=${RUSKI_COMPOSE_ENV_FILE:-${compose_dir}/.env}
cloudflared_env=${RUSKI_CLOUDFLARED_ENV_FILE:-/opt/ruski-report/secrets/cloudflared.env}
workbook_dir=${RUSKI_SOURCE_WORKBOOK_DIR:-/srv/ruski-report/source-workbooks}
work_dir=${RUSKI_BACKUP_WORK_DIR:-/var/lib/ruski-report-backup}
retention=${RUSKI_BACKUP_RETENTION:-27d}

for required_command in docker flock git hostname restic; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "${required_command}" >&2
    exit 1
  fi
done

if [[ ! -r "${compose_env}" ]]; then
  printf 'Compose environment file is not readable: %s\n' "${compose_env}" >&2
  exit 1
fi

if [[ ! -r "${RESTIC_PASSWORD_FILE}" ]]; then
  printf 'Restic password file is not readable: %s\n' "${RESTIC_PASSWORD_FILE}" >&2
  exit 1
fi

install -d -m 0700 "${work_dir}"
exec 9>"${work_dir}/operation.lock"
if ! flock -n 9; then
  printf 'Another Ruski Report backup operation is already running.\n' >&2
  exit 75
fi

run_dir=$(mktemp -d "${work_dir}/run.XXXXXX")
cleanup() {
  rm -rf -- "${run_dir}"
}
trap cleanup EXIT

install -d -m 0700 "${run_dir}/configuration"
install -d -m 0700 "${run_dir}/source-workbooks"

cd "${compose_dir}"
docker compose --env-file "${compose_env}" config --quiet

printf 'Creating a consistent PostgreSQL logical dump.\n'
docker compose --env-file "${compose_env}" exec -T postgres \
  sh -ceu 'exec pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom --no-owner --no-acl' \
  >"${run_dir}/database.dump"
chmod 0600 "${run_dir}/database.dump"
test -s "${run_dir}/database.dump"

docker compose --env-file "${compose_env}" exec -T postgres \
  pg_restore --list <"${run_dir}/database.dump" \
  >"${run_dir}/database-contents.txt"
chmod 0600 "${run_dir}/database-contents.txt"

install -m 0600 "${compose_env}" "${run_dir}/configuration/compose.env"
if [[ -r "${cloudflared_env}" ]]; then
  install -m 0600 \
    "${cloudflared_env}" \
    "${run_dir}/configuration/cloudflared.env"
fi

if [[ -d "${workbook_dir}" ]]; then
  cp -a "${workbook_dir}/." "${run_dir}/source-workbooks/"
fi

deployed_commit=unavailable
if deployed_commit_value=$(git -C "${compose_dir}/../.." rev-parse HEAD 2>/dev/null); then
  deployed_commit=${deployed_commit_value}
fi

{
  printf 'created_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'source_host=%s\n' "$(hostname --fqdn 2>/dev/null || hostname)"
  printf 'deployed_commit=%s\n' "${deployed_commit}"
  printf 'compose_project=ruski-report\n'
  docker compose --env-file "${compose_env}" images
} >"${run_dir}/deployment-manifest.txt"
chmod 0600 "${run_dir}/deployment-manifest.txt"

printf 'Uploading an encrypted snapshot to Amazon S3.\n'
restic backup \
  --host ruski-pi \
  --tag ruski-report \
  --tag automated \
  "${run_dir}"

printf 'Applying the %s snapshot-retention window.\n' "${retention}"
restic forget \
  --host ruski-pi \
  --tag ruski-report \
  --group-by host,tags \
  --keep-within "${retention}" \
  --prune

printf 'Backup completed successfully. Latest snapshot:\n'
restic snapshots --host ruski-pi --tag ruski-report --latest 1
