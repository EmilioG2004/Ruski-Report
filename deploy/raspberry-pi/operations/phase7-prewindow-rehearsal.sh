#!/usr/bin/env bash
set -Eeuo pipefail

readonly script_name=phase7-prewindow-rehearsal
readonly acknowledgement=DISPOSABLE_RESTORED_COPY_ONLY
readonly backup_root=/var/lib/ruski-report-backup
current_step=arguments
work_root=
network_name=
database_container=
api_container=
run_id=

fail() {
  printf '%s=failed step=%s reason=%s\n' \
    "${script_name}" "${current_step}" "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing_$1"
}

usage() {
  printf 'Usage: %s RELEASE_STATE SNAPSHOT_ID CANDIDATE_SOURCE QUALIFICATION_SOURCE EVIDENCE_FILE\n' \
    "$0" >&2
  exit 2
}

[[ $# -eq 5 ]] || usage
readonly release_state=$1
readonly snapshot_id=$2
readonly candidate_source=$3
readonly qualification_source=$4
readonly evidence_file=$5
readonly rollback_archive_file=${evidence_file%.json}.rollback-image.tar

cleanup_container() {
  local name=$1
  [[ -z "${name}" ]] && return 0
  if ! docker inspect "${name}" >/dev/null 2>&1; then
    return 0
  fi
  local label
  label=$(docker inspect --format \
    '{{index .Config.Labels "com.ruskireport.phase7.rehearsal"}}' "${name}") || return 1
  [[ "${label}" == "${run_id}" ]] || return 1
  docker rm -f -- "${name}" >/dev/null
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  local cleanup_status=0
  cleanup_container "${api_container}" || cleanup_status=1
  cleanup_container "${database_container}" || cleanup_status=1
  if [[ -n "${network_name}" ]] && docker network inspect "${network_name}" >/dev/null 2>&1; then
    local label
    label=$(docker network inspect --format \
      '{{index .Labels "com.ruskireport.phase7.rehearsal"}}' \
      "${network_name}") || cleanup_status=1
    if [[ "${label:-}" == "${run_id}" ]]; then
      docker network rm "${network_name}" >/dev/null || cleanup_status=1
    else
      cleanup_status=1
    fi
  fi
  if [[ -n "${work_root}" ]]; then
    case "${work_root}" in
      "${backup_root}"/phase7-prewindow.*)
        [[ ! -L "${work_root}" ]] && find "${work_root}" -depth -delete \
          >/dev/null 2>&1 || cleanup_status=1
        ;;
      *) cleanup_status=1 ;;
    esac
  fi
  unset database_url database_password loopback_database_url
  unset RESTIC_PASSWORD RESTIC_PASSWORD_COMMAND
  if [[ ${cleanup_status} -ne 0 ]]; then
    printf '%s=failed step=cleanup\n' "${script_name}" >&2
    exit 1
  fi
  if [[ ${status} -ne 0 ]]; then
    printf '%s=failed step=%s\n' "${script_name}" "${current_step}" >&2
  fi
  exit "${status}"
}
trap cleanup EXIT INT TERM HUP

current_step=preflight
[[ ${EUID} -eq 0 ]] || fail requires_root
for required in docker flock git openssl python3 restic sha256sum stat; do
  require_command "${required}"
done
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE is required}"
[[ "${snapshot_id}" =~ ^[a-f0-9]{64}$ ]] || fail snapshot_id_must_be_full
for path in "${release_state}" "${candidate_source}" "${qualification_source}" \
  "${evidence_file}"; do
  [[ "${path}" = /* ]] || fail paths_must_be_absolute
done
[[ ! -e "${evidence_file}" ]] || fail evidence_file_already_exists
[[ ! -e "${rollback_archive_file}" ]] || fail rollback_archive_already_exists
[[ -f "${release_state}" && ! -L "${release_state}" ]] || fail invalid_release_state
state_mode=$(stat -c '%a' "${release_state}" 2>/dev/null || \
  stat -f '%Lp' "${release_state}")
[[ "${state_mode}" == 600 ]] || fail release_state_mode
[[ -d "${candidate_source}/.git" || -f "${candidate_source}/.git" ]] || \
  fail candidate_source_not_git
[[ -d "${qualification_source}/.git" || -f "${qualification_source}/.git" ]] || \
  fail qualification_source_not_git

qualification_commit=$(git -C "${qualification_source}" rev-parse HEAD)
[[ "${qualification_commit}" =~ ^[a-f0-9]{40}$ ]] || fail qualification_commit
[[ -z $(git -C "${qualification_source}" status --porcelain=v1 \
  --untracked-files=all --ignore-submodules=none) ]] || fail qualification_source_dirty

declare -A release=()
while IFS='=' read -r key value || [[ -n "${key}${value}" ]]; do
  case "${key}" in
    RUSKI_RELEASE_SCHEMA_VERSION|RUSKI_RELEASE_COMMIT|RUSKI_RELEASE_SOURCE_REF|\
    RUSKI_API_IMAGE|RUSKI_RELEASE_IMAGE_ID|RUSKI_ROLLBACK_API_IMAGE|\
    RUSKI_ROLLBACK_IMAGE_ID|RUSKI_RELEASE_PREPARED_AT)
      [[ -z ${release[${key}]+x} && -n "${value}" ]] || fail release_state_duplicate
      release[${key}]=${value}
      ;;
    *) fail release_state_unknown_field ;;
  esac
done <"${release_state}"
for key in RUSKI_RELEASE_COMMIT RUSKI_RELEASE_IMAGE_ID RUSKI_ROLLBACK_IMAGE_ID; do
  [[ -n ${release[${key}]:-} ]] || fail release_state_incomplete
done
readonly candidate_commit=${release[RUSKI_RELEASE_COMMIT]}
readonly candidate_image_id=${release[RUSKI_RELEASE_IMAGE_ID]}
readonly rollback_image_id=${release[RUSKI_ROLLBACK_IMAGE_ID]}
[[ "${candidate_commit}" =~ ^[a-f0-9]{40}$ ]] || fail candidate_commit
[[ "${candidate_image_id}" =~ ^sha256:[a-f0-9]{64}$ ]] || fail candidate_image_id
[[ "${rollback_image_id}" =~ ^sha256:[a-f0-9]{64}$ ]] || fail rollback_image_id
[[ $(git -C "${candidate_source}" rev-parse HEAD) == "${candidate_commit}" ]] || \
  fail candidate_source_commit

"${candidate_source}/deploy/raspberry-pi/operations/prepare-release-image.sh" \
  verify "${release_state}" >/dev/null
[[ $(docker image inspect --format '{{.Id}}' "${candidate_image_id}") == \
  "${candidate_image_id}" ]] || fail candidate_image_unavailable
[[ $(docker image inspect --format '{{.Id}}' "${rollback_image_id}") == \
  "${rollback_image_id}" ]] || fail rollback_image_unavailable
[[ $(docker image inspect --format \
  '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
  "${candidate_image_id}") == "${candidate_commit}" ]] || fail candidate_revision

mapfile -t production_api_rows < <(docker ps -q \
  --filter label=com.docker.compose.project=ruski-report \
  --filter label=com.docker.compose.service=api)
mapfile -t production_postgres_rows < <(docker ps -q \
  --filter label=com.docker.compose.project=ruski-report \
  --filter label=com.docker.compose.service=postgres)
[[ ${#production_api_rows[@]} -eq 1 && -n ${production_api_rows[0]} ]] || \
  fail production_api_reference_not_unique
[[ ${#production_postgres_rows[@]} -eq 1 && \
  -n ${production_postgres_rows[0]} ]] || \
  fail production_postgres_reference_not_unique
readonly production_api=${production_api_rows[0]}
readonly production_postgres=${production_postgres_rows[0]}
[[ $(docker inspect --format '{{.Image}}' "${production_api}") == \
  "${rollback_image_id}" ]] || fail rollback_not_current_production_image
postgres_image_id=$(docker inspect --format '{{.Image}}' "${production_postgres}")
readonly postgres_image_id
[[ "${postgres_image_id}" =~ ^sha256:[a-f0-9]{64}$ ]] || fail postgres_image_id

install -d -m 0700 "${backup_root}"
exec 9>"${backup_root}/operation.lock"
flock -n 9 || fail backup_lock_busy
run_id=$(openssl rand -hex 8)
readonly run_id
work_root=$(mktemp -d "${backup_root}/phase7-prewindow.XXXXXXXX")
chmod 0700 "${work_root}"
network_name="phase7-net-${run_id}"
docker network create --internal \
  --label "com.ruskireport.phase7.rehearsal=${run_id}" \
  "${network_name}" >/dev/null

current_step=rollback_archive
docker image save --output "${work_root}/rollback-image.tar" \
  "${rollback_image_id}"
rollback_archive_digest=$(sha256sum "${work_root}/rollback-image.tar" | \
  awk '{print $1}')
[[ "${rollback_archive_digest}" =~ ^[a-f0-9]{64}$ ]] || \
  fail rollback_archive_digest

current_step=snapshot
snapshot_json=$(restic snapshots "${snapshot_id}" --host ruski-pi \
  --tag ruski-report --json)
snapshot_time=$(python3 -c '
import json,sys
x=json.load(sys.stdin)
expected=sys.argv[1]
rows=[row for row in x if row.get("id")==expected]
if len(rows)!=1: raise SystemExit(1)
print(rows[0]["time"])
' "${snapshot_id}" <<<"${snapshot_json}") || fail snapshot_not_unique
restic restore "${snapshot_id}" --host ruski-pi --tag ruski-report \
  --target "${work_root}/restore" >"${work_root}/restic.log" 2>&1
mapfile -t dump_files < <(find "${work_root}/restore" -type f \
  -name database.dump -print)
[[ ${#dump_files[@]} -eq 1 ]] || fail database_dump_count
readonly dump_file=${dump_files[0]}
[[ -f "${dump_file}" && ! -L "${dump_file}" && -s "${dump_file}" ]] || \
  fail database_dump_invalid
dump_digest=$(sha256sum "${dump_file}" | awk '{print $1}')
readonly dump_digest
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --volume "${dump_file}:/tmp/database.dump:ro" \
  "${postgres_image_id}" pg_restore --list /tmp/database.dump \
  >"${work_root}/dump-catalog.txt" 2>/dev/null

current_step=qualification_image
readonly qualification_image="phase7-qualification:${qualification_commit}"
docker build --target build \
  --label "org.opencontainers.image.revision=${qualification_commit}" \
  --tag "${qualification_image}" \
  "${qualification_source}/backend" >"${work_root}/qualification-build.log" 2>&1
qualification_image_id=$(docker image inspect --format '{{.Id}}' \
  "${qualification_image}")
readonly qualification_image_id
[[ "${qualification_image_id}" =~ ^sha256:[a-f0-9]{64}$ ]] || \
  fail qualification_image_id

stop_database() {
  cleanup_container "${api_container}"
  api_container=
  cleanup_container "${database_container}"
  database_container=
  unset database_url database_password loopback_database_url
}

start_database() {
  local role=$1
  database_container="phase7-db-${role}-${run_id}"
  database_name="phase7-data-${role}-${run_id}"
  database_user="phase7-user-${role}-${run_id}"
  database_password=$(openssl rand -hex 32)
  database_url="postgresql://${database_user}:${database_password}@${database_container}:5432/${database_name}"
  export database_url database_password
  docker run --detach --name "${database_container}" \
    --label "com.ruskireport.phase7.rehearsal=${run_id}" \
    --network "${network_name}" --network-alias "${database_container}" \
    --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=3g \
    --memory 2g --cpus 2 --pids-limit 256 \
    --env "POSTGRES_DB=${database_name}" \
    --env "POSTGRES_USER=${database_user}" \
    --env "POSTGRES_PASSWORD=${database_password}" \
    "${postgres_image_id}" >/dev/null
  [[ $(docker inspect --format '{{.Image}}' "${database_container}") == \
    "${postgres_image_id}" ]] || fail isolated_postgres_image
  [[ $(docker inspect --format '{{len .NetworkSettings.Networks}}' \
    "${database_container}") == 1 ]] || fail isolated_postgres_network_count
  [[ $(docker inspect --format \
    "{{with index .NetworkSettings.Networks \"${network_name}\"}}yes{{end}}" \
    "${database_container}") == yes ]] || fail isolated_postgres_network
  [[ $(docker inspect --format '{{json .NetworkSettings.Ports}}' \
    "${database_container}") == '{}' ]] || fail isolated_postgres_ports
  for _ in {1..45}; do
    if docker exec "${database_container}" pg_isready \
      --username "${database_user}" --dbname "${database_name}" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  docker exec "${database_container}" pg_isready \
    --username "${database_user}" --dbname "${database_name}" >/dev/null
  docker cp "${dump_file}" "${database_container}:/tmp/database.dump"
  docker exec "${database_container}" pg_restore --exit-on-error --no-owner \
    --no-acl --username "${database_user}" --dbname "${database_name}" \
    /tmp/database.dump >"${work_root}/restore-${role}.log" 2>&1
}

run_guard() {
  docker run --rm --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --volume "${qualification_source}/scripts/release-qualification/restored-database-guard.mjs:/guard.mjs:ro" \
    --env "RUSKI_QUALIFICATION_RESTORED_DATABASE_URL=${database_url}" \
    --env "RUSKI_QUALIFICATION_EXPECTED_DATABASE_HOST=${database_container}" \
    --env "RUSKI_QUALIFICATION_EXPECTED_DATABASE_NAME=${database_name}" \
    --env "RUSKI_QUALIFICATION_EXPECTED_DATABASE_USER=${database_user}" \
    --env "RUSKI_QUALIFICATION_RESTORED_ACK=${acknowledgement}" \
    "${qualification_image_id}" node /guard.mjs >/dev/null
}

run_candidate_command() {
  docker run --rm --network "${network_name}" --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL \
    --security-opt no-new-privileges:true --memory 1g --cpus 2 --pids-limit 256 \
    --env "DATABASE_URL=${database_url}" --env DATABASE_SSL=false \
    "$@"
}

run_qualification_command() {
  docker run --rm --network "${network_name}" --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=256m --cap-drop ALL \
    --security-opt no-new-privileges:true --memory 2g --cpus 2 --pids-limit 384 \
    --volume "${qualification_source}/backend/migrations:/app/migrations:ro" \
    --env "DATABASE_URL=${database_url}" --env DATABASE_SSL=false \
    --env "RUSKI_QUALIFICATION_RESTORED_DATABASE_URL=${database_url}" \
    --env "RUSKI_QUALIFICATION_EXPECTED_DATABASE_HOST=${database_container}" \
    --env "RUSKI_QUALIFICATION_EXPECTED_DATABASE_NAME=${database_name}" \
    --env "RUSKI_QUALIFICATION_EXPECTED_DATABASE_USER=${database_user}" \
    --env "RUSKI_QUALIFICATION_RESTORED_ACK=${acknowledgement}" \
    "${qualification_image_id}" "$@"
}

run_qualification_command_with() {
  local -a extra_options=()
  while [[ $# -gt 0 && $1 != -- ]]; do
    extra_options+=("$1")
    shift
  done
  [[ $# -gt 0 && $1 == -- ]] || fail qualification_command_separator
  shift
  docker run --rm --network "${network_name}" --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=256m --cap-drop ALL \
    --security-opt no-new-privileges:true --memory 2g --cpus 2 --pids-limit 384 \
    --volume "${qualification_source}/backend/migrations:/app/migrations:ro" \
    --env "DATABASE_URL=${database_url}" --env DATABASE_SSL=false \
    --env "RUSKI_QUALIFICATION_RESTORED_DATABASE_URL=${database_url}" \
    --env "RUSKI_QUALIFICATION_EXPECTED_DATABASE_HOST=${database_container}" \
    --env "RUSKI_QUALIFICATION_EXPECTED_DATABASE_NAME=${database_name}" \
    --env "RUSKI_QUALIFICATION_EXPECTED_DATABASE_USER=${database_user}" \
    --env "RUSKI_QUALIFICATION_RESTORED_ACK=${acknowledgement}" \
    "${extra_options[@]}" "${qualification_image_id}" "$@"
}

start_api() {
  local role=$1
  local image_id=$2
  api_container="phase7-api-${role}-${run_id}"
  docker run --detach --name "${api_container}" \
    --label "com.ruskireport.phase7.rehearsal=${run_id}" \
    --network "${network_name}" --network-alias "${api_container}" \
    --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
    --security-opt no-new-privileges:true --cap-drop ALL \
    --memory 1g --cpus 2 --pids-limit 256 \
    --env NODE_ENV=production --env HOST=0.0.0.0 --env PORT=3000 \
    --env "DATABASE_URL=${database_url}" --env DATABASE_SSL=false \
    --env DATABASE_MIGRATIONS_DIR=/app/migrations \
    --env ADMIN_API_TOKEN=phase7-rehearsal-only \
    --env ADMIN_WEB_ORIGIN=https://phase7-rehearsal.invalid \
    --env ADMIN_AUTH_SECURITY_SECRET=phase7-rehearsal-only-security-secret \
    --env MODERATION_OPERATOR_ID=phase7-rehearsal \
    --env COMMENT_MODERATION_RULES_PATH=/app/config/comment-moderation-rules.json \
    "${image_id}" >/dev/null
  [[ $(docker inspect --format '{{.Image}}' "${api_container}") == \
    "${image_id}" ]] || fail isolated_api_image
  [[ $(docker inspect --format '{{len .NetworkSettings.Networks}}' \
    "${api_container}") == 1 ]] || fail isolated_api_network_count
  [[ $(docker inspect --format '{{json .NetworkSettings.Ports}}' \
    "${api_container}") == '{}' ]] || fail isolated_api_ports
  for _ in {1..45}; do
    if run_qualification_command node -e \
      'fetch(process.argv[1]).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))' \
      "http://${api_container}:3000/api/health" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  run_qualification_command node -e \
    'fetch(process.argv[1]).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))' \
    "http://${api_container}:3000/api/health" >/dev/null
}

select_legacy_tournament() {
  local ids
  local -a rows
  ids=$(docker exec "${database_container}" psql --username \
    "${database_user}" --dbname "${database_name}" --tuples-only --no-align \
    --command "SELECT id FROM tournaments WHERE year = 2026 ORDER BY id")
  mapfile -t rows <<<"${ids}"
  [[ ${#rows[@]} -eq 1 && -n ${rows[0]} ]] || \
    fail completed_2026_tournament_not_unique
  printf '%s\n' "${rows[0]}"
}

current_step=restored_failure_injections
failure_scenarios=(
  backfill-apply
  projection-materialization
  active-pointer
  before-commit
)
failure_index=0
for failure_scenario in "${failure_scenarios[@]}"; do
  failure_index=$((failure_index + 1))
  start_database "rehearsal-failure-${failure_index}"
  run_guard
  run_candidate_command "${candidate_image_id}" node dist/database/migrate.js \
    >"${work_root}/failure-${failure_index}-migrate.log" 2>&1
  failure_tournament_id=$(select_legacy_tournament)
  run_qualification_command_with \
    --env RUSKI_QUALIFICATION_RESTORED_WRITE_ACK=I_ACKNOWLEDGE_THIS_IS_AN_ISOLATED_RESTORED_COPY \
    -- \
    node dist/database/rehearse-backfill-failures.js \
    --tournament-id "${failure_tournament_id}" \
    --scenario "${failure_scenario}" \
    >"${work_root}/failure-${failure_index}.json"
  stop_database
done

current_step=candidate_restore
start_database rehearsal-candidate
run_guard
run_candidate_command "${candidate_image_id}" node dist/database/migrate.js \
  >"${work_root}/migrate.log" 2>&1
migration_count=$(docker exec "${database_container}" psql --username \
  "${database_user}" --dbname "${database_name}" --tuples-only --no-align \
  --command 'SELECT count(*) FROM schema_migrations')
legacy_tournament_id=$(select_legacy_tournament)
readonly legacy_tournament_id

run_backfill() {
  local output=$1
  shift
  run_candidate_command "${candidate_image_id}" \
    node dist/database/backfill-legacy.js \
    --tournament-id "${legacy_tournament_id}" "$@" >"${output}"
}

current_step=backfill_determinism
run_backfill "${work_root}/dry-1.json"
run_backfill "${work_root}/dry-2.json"
run_backfill "${work_root}/apply.json" --apply
run_backfill "${work_root}/apply-2.json" --apply
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --volume "${qualification_source}/scripts/release-qualification:/qualification:ro" \
  --volume "${work_root}:/evidence:ro" \
  "${qualification_image_id}" node /qualification/backfill-sequence.mjs \
  /evidence/dry-1.json /evidence/dry-2.json /evidence/apply.json \
  /evidence/apply-2.json >"${work_root}/backfill-sequence.json"

current_step=restored_lifecycle
qualification_administrator_id=$(docker exec "${database_container}" psql \
  --username "${database_user}" --dbname "${database_name}" \
  --tuples-only --no-align --command \
  "SELECT id FROM admin_accounts WHERE status = 'active' ORDER BY id LIMIT 1")
[[ "${qualification_administrator_id}" =~ ^[a-f0-9-]{36}$ ]] || \
  fail active_qualification_administrator_missing
run_qualification_command_with \
  --env RUSKI_QUALIFICATION_RESTORED_WRITE_ACK=I_ACKNOWLEDGE_THIS_IS_AN_ISOLATED_RESTORED_COPY \
  --env "RUSKI_QUALIFICATION_ADMINISTRATOR_ID=${qualification_administrator_id}" \
  --env "RUSKI_QUALIFICATION_LEGACY_TOURNAMENT_ID=${legacy_tournament_id}" \
  --env "RUSKI_QUALIFICATION_CANDIDATE_SHA=${candidate_commit}" \
  -- \
  node dist/database/rehearse-tournament-lifecycle.js \
  >"${work_root}/lifecycle.json"

current_step=candidate_api
start_api candidate "${candidate_image_id}"
run_qualification_command_with \
  --volume "${qualification_source}/scripts/release-qualification/isolated-realtime-smoke.mjs:/isolated-realtime-smoke.mjs:ro" \
  -- \
  node /isolated-realtime-smoke.mjs "http://${api_container}:3000" \
  >"${work_root}/candidate-realtime.json"

current_step=public_equivalence
run_qualification_command_with \
  --volume "${qualification_source}/scripts/release-qualification:/qualification:ro" \
  --volume "${work_root}:/evidence:ro" \
  --env "QUALIFICATION_BASE_URL=http://${api_container}:3000/api" \
  --env "LEGACY_TOURNAMENT_ID=${legacy_tournament_id}" \
  -- \
  node --input-type=module -e '
    import {readFileSync} from "node:fs";
    import {comparePublicContracts} from "/qualification/public-equivalence.mjs";
    const base=process.env.QUALIFICATION_BASE_URL;
    const id=process.env.LEGACY_TOURNAMENT_ID;
    const get=async path=>{const r=await fetch(`${base}/${path}`);if(!r.ok)throw new Error(`HTTP_${r.status}`);return r.json()};
    const legacyTournament=await get(`tournaments/${id}`);
    const legacyMatches=await get(`tournaments/${id}/matches`);
    const legacyMatchDetails=await Promise.all(legacyMatches.map(x=>get(`matches/${x.id}`)));
    const history=await get("v2/tournaments/history");
    const item=history.tournaments.find(x=>x?.tournament?.id===id);
    if(!item)throw new Error("LEGACY_HISTORY_MISSING");
    const version=item.projection?.version;
    if(!Number.isSafeInteger(version)||version<1)throw new Error("PROJECTION_VERSION_INVALID");
    const canonicalTournament=await get(`v2/tournaments/${id}?projectionVersion=${version}`);
    const canonicalMatches=await get(`v2/tournaments/${id}/matches?projectionVersion=${version}`);
    const canonicalMatchDetails=await Promise.all(canonicalMatches.matches.map(x=>get(`v2/matches/${x.id}?projectionVersion=${version}`)));
    const sequence=JSON.parse(readFileSync("/evidence/backfill-sequence.json","utf8"));
    const comparison=comparePublicContracts({legacyTournament,legacyMatches,legacyMatchDetails,canonicalTournament:canonicalTournament.tournament,canonicalMatches:canonicalMatches.matches,canonicalMatchDetails:canonicalMatchDetails.map(x=>x.match),expectedTournamentStatisticCorrections:sequence.checkpointEvidence.tournamentStatisticCorrections});
    if(!comparison.equivalent){console.log(JSON.stringify({status:"failed",mismatchCodes:comparison.mismatches.map(x=>x.code)}));process.exit(2)}
    const route=await fetch(`${base}/admin/tournaments/2026/upload-scorebook?gameType=ruski`,{method:"POST"});
    if(route.status!==401)throw new Error("LEGACY_ROUTE_BOUNDARY_CHANGED");
    console.log(JSON.stringify({status:"passed",legacyMatchCount:legacyMatches.length,canonicalMatchCount:canonicalMatches.matches.length,historicalTournamentCount:history.tournaments.length,projectionVersion:version,legacyWorkbookRouteStatus:route.status}));
  ' >"${work_root}/equivalence.json"

current_step=rollback_restore
stop_database
rollback_started=$(date +%s)
start_database rollback
start_api rollback "${rollback_image_id}"
run_qualification_command_with \
  --volume "${qualification_source}/scripts/release-qualification/isolated-realtime-smoke.mjs:/isolated-realtime-smoke.mjs:ro" \
  -- \
  node /isolated-realtime-smoke.mjs "http://${api_container}:3000" \
  >"${work_root}/rollback-realtime.json"
run_qualification_command_with \
  --env "ROLLBACK_BASE_URL=http://${api_container}:3000/api" \
  --env "LEGACY_TOURNAMENT_ID=${legacy_tournament_id}" \
  -- \
  node --input-type=module -e '
    const base=process.env.ROLLBACK_BASE_URL,id=process.env.LEGACY_TOURNAMENT_ID;
    const get=async path=>{const r=await fetch(`${base}/${path}`);if(!r.ok)throw new Error(`HTTP_${r.status}`);return r.json()};
    await get("health");
    await get(`tournaments/${id}`);
    const matches=await get(`tournaments/${id}/matches`);
    if(!Array.isArray(matches)||matches.length===0)throw new Error("LEGACY_MATCHES_MISSING");
    await get(`matches/${matches[0].id}`);
    const comments=await get(`matches/${matches[0].id}/comments`);
    console.log(JSON.stringify({status:"passed",matchCount:matches.length,commentRead:Array.isArray(comments)}));
  ' >"${work_root}/rollback.json"
rollback_seconds=$(( $(date +%s) - rollback_started ))

current_step=resource_cleanup
cleanup_container "${api_container}"
api_container=
cleanup_container "${database_container}"
database_container=
[[ -z $(docker ps -aq --filter \
  "label=com.ruskireport.phase7.rehearsal=${run_id}") ]] || \
  fail labeled_container_leak
[[ $(docker network inspect --format \
  '{{index .Labels "com.ruskireport.phase7.rehearsal"}}' \
  "${network_name}") == "${run_id}" ]] || fail rehearsal_network_label
docker network rm "${network_name}" >/dev/null
network_name=

current_step=evidence
evidence_parent=$(dirname "${evidence_file}")
install -d -m 0700 "${evidence_parent}"
temporary_evidence="${work_root}/evidence.json"
export work_root candidate_commit candidate_image_id qualification_commit
export qualification_image_id rollback_image_id snapshot_id snapshot_time
export dump_digest postgres_image_id migration_count rollback_seconds
export rollback_archive_digest
python3 - "${temporary_evidence}" <<'PY'
import json, os, sys
root=os.environ["work_root"]
def load(name):
    with open(os.path.join(root,name),encoding="utf-8") as handle:
        return json.load(handle)
sequence=load("backfill-sequence.json")
result={
  "schemaVersion":1,
  "status":"passed",
  "candidate":{"commit":os.environ["candidate_commit"],"imageId":os.environ["candidate_image_id"]},
  "qualification":{"commit":os.environ["qualification_commit"],"imageId":os.environ["qualification_image_id"]},
  "rollback":{"imageId":os.environ["rollback_image_id"],"archiveSha256":os.environ["rollback_archive_digest"],"restoreSeconds":int(os.environ["rollback_seconds"]),"checks":load("rollback.json"),"realtime":load("rollback-realtime.json")},
  "snapshot":{"id":os.environ["snapshot_id"],"time":os.environ["snapshot_time"],"dumpSha256":os.environ["dump_digest"]},
  "database":{"postgresImageId":os.environ["postgres_image_id"],"migrationCount":int(os.environ["migration_count"])},
  "backfill":{"status":sequence["status"],"sourceSnapshotVersion":sequence["sourceSnapshotVersion"],"sourceDigest":sequence["sourceDigest"],"planDigest":sequence["planDigest"],"mappingDigest":sequence["mappingDigest"],"counts":sequence["counts"],"issueCodes":sequence["issueCodes"],"checkpointEvidence":sequence["checkpointEvidence"]},
  "failureInjections":[load(f"failure-{index}.json") for index in range(1,5)],
  "lifecycle":load("lifecycle.json"),
  "equivalence":load("equivalence.json"),
  "candidateRealtime":load("candidate-realtime.json"),
  "cleanup":"passed"
}
with open(sys.argv[1],"w",encoding="utf-8") as handle:
    json.dump(result,handle,separators=(",",":"),sort_keys=True)
    handle.write("\n")
PY
install -m 0600 "${work_root}/rollback-image.tar" "${rollback_archive_file}"
install -m 0600 "${temporary_evidence}" "${evidence_file}"
printf '%s=pass candidate_commit=%s qualification_commit=%s snapshot_id=%s\n' \
  "${script_name}" "${candidate_commit}" "${qualification_commit}" \
  "${snapshot_id}"
