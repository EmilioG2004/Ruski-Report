#!/usr/bin/env bash
set -Eeuo pipefail

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE is required}"

work_dir=${RUSKI_BACKUP_WORK_DIR:-/var/lib/ruski-report-backup}

install -d -m 0700 "${work_dir}"
exec 9>"${work_dir}/operation.lock"
if ! flock -n 9; then
  printf 'Another Ruski Report backup operation is already running.\n' >&2
  exit 75
fi

printf 'Checking repository metadata and a rotating 25%% data subset.\n'
restic check --read-data-subset=25%
