#!/usr/bin/env bash
set -Eeuo pipefail

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE is required}"

compose_dir=${RUSKI_COMPOSE_DIR:-/opt/ruski-report/source/deploy/raspberry-pi}
compose_env=${RUSKI_COMPOSE_ENV_FILE:-${compose_dir}/.env}
work_dir=${RUSKI_BACKUP_WORK_DIR:-/var/lib/ruski-report-backup}
snapshot=${1:-latest}

for required_command in docker flock openssl restic; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "${required_command}" >&2
    exit 1
  fi
done

install -d -m 0700 "${work_dir}"
exec 9>"${work_dir}/operation.lock"
if ! flock -n 9; then
  printf 'Another Ruski Report backup operation is already running.\n' >&2
  exit 75
fi

restore_root=$(mktemp -d "${work_dir}/restore.XXXXXX")
suffix="$$-$(date -u +%s)"
postgres_container="ruski-restore-postgres-${suffix}"
api_container="ruski-restore-api-${suffix}"

cleanup() {
  status=$?
  trap - EXIT

  if [[ ${status} -ne 0 ]]; then
    printf 'Restore rehearsal failed with exit status %s.\n' "${status}" >&2
    for container_name in "${api_container}" "${postgres_container}"; do
      if docker inspect "${container_name}" >/dev/null 2>&1; then
        docker inspect --format \
          'container={{.Name}} state={{.State.Status}} exit={{.State.ExitCode}} error={{.State.Error}}' \
          "${container_name}" >&2 || true
        docker logs --tail 80 "${container_name}" >&2 || true
      fi
    done
  fi

  docker rm -f "${api_container}" >/dev/null 2>&1 || true
  docker rm -f "${postgres_container}" >/dev/null 2>&1 || true
  rm -rf -- "${restore_root}"
  exit "${status}"
}
trap cleanup EXIT

printf 'Restoring snapshot %s into an isolated rehearsal directory.\n' "${snapshot}"
restic restore "${snapshot}" \
  --host ruski-pi \
  --tag ruski-report \
  --target "${restore_root}"

dump_file=$(find "${restore_root}" -type f -name database.dump -print -quit)
if [[ -z "${dump_file}" ]]; then
  printf 'The restored snapshot does not contain database.dump.\n' >&2
  exit 1
fi

cd "${compose_dir}"
postgres_id=$(docker compose --env-file "${compose_env}" ps -q postgres)
api_id=$(docker compose --env-file "${compose_env}" ps -q api)
if [[ -z "${postgres_id}" || -z "${api_id}" ]]; then
  printf 'The production PostgreSQL and API containers must be running.\n' >&2
  exit 1
fi

postgres_image=$(docker inspect --format '{{.Config.Image}}' "${postgres_id}")
api_image=$(docker inspect --format '{{.Config.Image}}' "${api_id}")
database_network=$(docker inspect --format \
  '{{range $name, $configuration := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' \
  "${postgres_id}" | head -n 1)

if [[ -z "${database_network}" ]]; then
  printf 'Could not determine the private PostgreSQL Docker network.\n' >&2
  exit 1
fi

restore_password=$(openssl rand -hex 24)
docker run --detach --rm \
  --name "${postgres_container}" \
  --network "${database_network}" \
  --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=1g \
  --env POSTGRES_DB=ruski_restore \
  --env POSTGRES_USER=ruski_restore \
  --env "POSTGRES_PASSWORD=${restore_password}" \
  "${postgres_image}" >/dev/null

for _ in {1..30}; do
  if docker exec "${postgres_container}" \
    pg_isready --username ruski_restore --dbname ruski_restore >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

docker exec "${postgres_container}" \
  pg_isready --username ruski_restore --dbname ruski_restore >/dev/null
docker cp "${dump_file}" "${postgres_container}:/tmp/database.dump"
docker exec "${postgres_container}" \
  pg_restore \
    --exit-on-error \
    --no-owner \
    --no-acl \
    --username ruski_restore \
    --dbname ruski_restore \
    /tmp/database.dump

tournament_id=$(docker exec "${postgres_container}" \
  psql --username ruski_restore --dbname ruski_restore --tuples-only --no-align \
  --command 'SELECT id FROM tournaments ORDER BY id LIMIT 1')
if [[ -z "${tournament_id}" ]]; then
  printf 'Restore succeeded, but no tournament exists for API verification.\n' >&2
  exit 1
fi

docker run --detach --rm \
  --name "${api_container}" \
  --network "${database_network}" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  --env NODE_ENV=production \
  --env HOST=0.0.0.0 \
  --env PORT=3000 \
  --env "DATABASE_URL=postgresql://ruski_restore:${restore_password}@${postgres_container}:5432/ruski_restore" \
  --env DATABASE_SSL=false \
  --env DATABASE_MIGRATIONS_DIR=/app/migrations \
  --env ADMIN_API_TOKEN=restore-rehearsal-only \
  --env MODERATION_OPERATOR_ID=restore-rehearsal \
  --env COMMENT_MODERATION_RULES_PATH=/app/config/comment-moderation-rules.json \
  "${api_image}" >/dev/null

verify_api_url() {
  docker exec "${api_id}" node -e \
    'fetch(process.argv[1]).then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));' \
    "$1"
}

for _ in {1..30}; do
  if verify_api_url \
    "http://${api_container}:3000/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

verify_api_url "http://${api_container}:3000/api/health"
verify_api_url \
  "http://${api_container}:3000/api/tournaments/${tournament_id}"

printf 'Clean restore rehearsal passed through GET /api/tournaments/%s.\n' \
  "${tournament_id}"
