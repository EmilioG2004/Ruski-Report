#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  printf 'Run this command with sudo.\n' >&2
  exit 1
fi

secrets_dir=/opt/ruski-report/secrets
environment_file=${secrets_dir}/restic.env
password_file=${secrets_dir}/restic-password
operator_group=root

if [[ -n ${SUDO_USER:-} && ${SUDO_USER} != root ]]; then
  operator_group=$(id -gn "${SUDO_USER}")
fi

if [[ -e "${environment_file}" || -e "${password_file}" ]]; then
  printf 'Backup secret files already exist; refusing to overwrite them.\n' >&2
  exit 1
fi

for required_command in install openssl stat; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "${required_command}" >&2
    exit 1
  fi
done

read -r -p 'Paste the CloudFormation ResticRepository output: ' repository
if [[ ! ${repository} =~ ^s3:s3\.us-east-1\.amazonaws\.com/ruski-report-backups-[0-9]{12}-us-east-1/restic$ ]]; then
  printf 'The repository does not match the expected us-east-1 stack output.\n' >&2
  exit 1
fi

read -r -p 'Paste the AWS access key ID: ' access_key_id
if [[ ! ${access_key_id} =~ ^AKIA[A-Z0-9]{16}$ ]]; then
  printf 'The access key ID is not a valid long-term IAM user key.\n' >&2
  exit 1
fi

read -r -s -p 'Paste the AWS secret access key (input is hidden): ' secret_access_key
printf '\n'
if [[ ${#secret_access_key} -ne 40 ]]; then
  printf 'The AWS secret access key must contain exactly 40 characters.\n' >&2
  exit 1
fi

install -d -o root -g "${operator_group}" -m 0750 "${secrets_dir}"
umask 077
environment_temp=$(mktemp "${secrets_dir}/restic.env.XXXXXX")
password_temp=$(mktemp "${secrets_dir}/restic-password.XXXXXX")

cleanup() {
  unset repository access_key_id secret_access_key restic_password
  rm -f -- "${environment_temp}" "${password_temp}"
}
trap cleanup EXIT

restic_password=$(openssl rand -base64 48)
printf '%s\n' "${restic_password}" >"${password_temp}"
printf '%s\n' \
  "RESTIC_REPOSITORY=${repository}" \
  "RESTIC_PASSWORD_FILE=${password_file}" \
  'RESTIC_CACHE_DIR=/var/cache/ruski-report-restic' \
  "AWS_ACCESS_KEY_ID=${access_key_id}" \
  "AWS_SECRET_ACCESS_KEY=${secret_access_key}" \
  'AWS_DEFAULT_REGION=us-east-1' \
  'RUSKI_COMPOSE_DIR=/opt/ruski-report/source/deploy/raspberry-pi' \
  'RUSKI_COMPOSE_ENV_FILE=/opt/ruski-report/source/deploy/raspberry-pi/.env' \
  'RUSKI_CLOUDFLARED_ENV_FILE=/opt/ruski-report/secrets/cloudflared.env' \
  'RUSKI_SOURCE_WORKBOOK_DIR=/srv/ruski-report/source-workbooks' \
  'RUSKI_BACKUP_WORK_DIR=/var/lib/ruski-report-backup' \
  >"${environment_temp}"

install -o root -g root -m 0600 "${environment_temp}" "${environment_file}"
install -o root -g root -m 0600 "${password_temp}" "${password_file}"

printf '\nSave this restic repository password in your password manager now:\n\n'
printf '%s\n\n' "${restic_password}"
printf 'The AWS key and restic password were stored in root-only files.\n'
stat -c '%A %U:%G %n' "${environment_file}" "${password_file}"
