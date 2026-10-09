#!/usr/bin/env bash
set -Eeuo pipefail

readonly script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
readonly deployment_dir=$(CDPATH= cd -- "${script_dir}/.." && pwd)
readonly repository_root=$(CDPATH= cd -- "${script_dir}/../../.." && pwd)

temporary_state_file=
cleanup() {
  local status=$?
  if [[ -n "${temporary_state_file}" && -f "${temporary_state_file}" ]]; then
    rm -f -- "${temporary_state_file}"
  fi
  return "${status}"
}
trap cleanup EXIT

fail() {
  printf 'prepare-release-image: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command '$1' is unavailable"
}

require_clean_candidate() {
  local expected_commit=$1
  local head_commit
  local status

  head_commit=$(git -C "${repository_root}" rev-parse HEAD 2>/dev/null) ||
    fail "the repository HEAD could not be resolved"
  [[ "${head_commit}" == "${expected_commit}" ]] ||
    fail "the checked-out commit does not match the release candidate"

  status=$(git -C "${repository_root}" status \
    --porcelain=v1 --untracked-files=all --ignore-submodules=none 2>/dev/null) ||
    fail "the candidate worktree status could not be read"
  [[ -z "${status}" ]] ||
    fail "the release candidate worktree is dirty"
}

resolve_candidate_commit() {
  local candidate_ref=$1
  local candidate_spec
  local commit

  [[ "${candidate_ref}" =~ ^[A-Za-z0-9._/-]+$ ]] ||
    fail "the candidate must be a full commit ID or an exact tag"

  if [[ "${candidate_ref}" =~ ^[0-9a-f]{40}$|^[0-9a-f]{64}$ ]]; then
    candidate_spec=${candidate_ref}
  elif git -C "${repository_root}" rev-parse --verify --quiet \
    "refs/tags/${candidate_ref}^{commit}" >/dev/null; then
    candidate_spec="refs/tags/${candidate_ref}"
  else
    fail "the candidate must be a full commit ID or an exact tag"
  fi

  commit=$(git -C "${repository_root}" rev-parse --verify \
    "${candidate_spec}^{commit}" 2>/dev/null) ||
    fail "the candidate commit could not be resolved"
  [[ "${commit}" =~ ^[0-9a-f]{40}$|^[0-9a-f]{64}$ ]] ||
    fail "the resolved candidate commit is invalid"
  printf '%s\n' "${commit}"
}

require_image_id() {
  [[ "$1" =~ ^sha256:[0-9a-f]{64}$ ]] ||
    fail "Docker returned an invalid immutable image ID"
}

image_id_for() {
  docker image inspect --format '{{.Id}}' "$1" 2>/dev/null
}

image_revision_for() {
  docker image inspect --format \
    '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
    "$1" 2>/dev/null
}

print_summary() {
  local status=$1
  printf 'status=%s\n' "${status}"
  printf 'releaseCommit=%s\n' "${RUSKI_RELEASE_COMMIT}"
  printf 'releaseImage=%s\n' "${RUSKI_API_IMAGE}"
  printf 'releaseImageId=%s\n' "${RUSKI_RELEASE_IMAGE_ID}"
  printf 'rollbackImage=%s\n' "${RUSKI_ROLLBACK_API_IMAGE}"
  printf 'rollbackImageId=%s\n' "${RUSKI_ROLLBACK_IMAGE_ID}"
}

load_state() {
  local state_file=$1
  local state_mode
  local key
  local value
  local schema_seen=0
  local commit_seen=0
  local source_seen=0
  local image_seen=0
  local image_id_seen=0
  local rollback_seen=0
  local rollback_id_seen=0
  local prepared_seen=0

  [[ -f "${state_file}" && ! -L "${state_file}" ]] ||
    fail "the release image state is not a regular file"
  state_mode=$(stat -c '%a' "${state_file}" 2>/dev/null ||
    stat -f '%Lp' "${state_file}" 2>/dev/null) ||
    fail "the release image state permissions could not be read"
  [[ "${state_mode}" == "600" ]] ||
    fail "the release image state must have mode 0600"

  RUSKI_RELEASE_SCHEMA_VERSION=
  RUSKI_RELEASE_COMMIT=
  RUSKI_RELEASE_SOURCE_REF=
  RUSKI_API_IMAGE=
  RUSKI_RELEASE_IMAGE_ID=
  RUSKI_ROLLBACK_API_IMAGE=
  RUSKI_ROLLBACK_IMAGE_ID=
  RUSKI_RELEASE_PREPARED_AT=

  while IFS='=' read -r key value || [[ -n "${key}${value}" ]]; do
    [[ -n "${key}" && -n "${value}" ]] ||
      fail "the release image state contains an empty field"
    case "${key}" in
      RUSKI_RELEASE_SCHEMA_VERSION)
        ((schema_seen += 1))
        RUSKI_RELEASE_SCHEMA_VERSION=${value}
        ;;
      RUSKI_RELEASE_COMMIT)
        ((commit_seen += 1))
        RUSKI_RELEASE_COMMIT=${value}
        ;;
      RUSKI_RELEASE_SOURCE_REF)
        ((source_seen += 1))
        RUSKI_RELEASE_SOURCE_REF=${value}
        ;;
      RUSKI_API_IMAGE)
        ((image_seen += 1))
        RUSKI_API_IMAGE=${value}
        ;;
      RUSKI_RELEASE_IMAGE_ID)
        ((image_id_seen += 1))
        RUSKI_RELEASE_IMAGE_ID=${value}
        ;;
      RUSKI_ROLLBACK_API_IMAGE)
        ((rollback_seen += 1))
        RUSKI_ROLLBACK_API_IMAGE=${value}
        ;;
      RUSKI_ROLLBACK_IMAGE_ID)
        ((rollback_id_seen += 1))
        RUSKI_ROLLBACK_IMAGE_ID=${value}
        ;;
      RUSKI_RELEASE_PREPARED_AT)
        ((prepared_seen += 1))
        RUSKI_RELEASE_PREPARED_AT=${value}
        ;;
      *) fail "the release image state contains an unknown field" ;;
    esac
  done <"${state_file}"

  [[ ${schema_seen} -eq 1 && ${commit_seen} -eq 1 &&
     ${source_seen} -eq 1 && ${image_seen} -eq 1 &&
     ${image_id_seen} -eq 1 && ${rollback_seen} -eq 1 &&
     ${rollback_id_seen} -eq 1 && ${prepared_seen} -eq 1 ]] ||
    fail "the release image state is incomplete or has duplicate fields"
  [[ "${RUSKI_RELEASE_SCHEMA_VERSION}" == "1" ]] ||
    fail "the release image state schema is unsupported"
  [[ "${RUSKI_RELEASE_COMMIT}" =~ ^[0-9a-f]{40}$|^[0-9a-f]{64}$ ]] ||
    fail "the recorded release commit is invalid"
  [[ "${RUSKI_RELEASE_SOURCE_REF}" =~ ^[A-Za-z0-9._/-]+$ ]] ||
    fail "the recorded source reference is invalid"
  [[ "${RUSKI_API_IMAGE}" == "ruski-report-api:phase7-${RUSKI_RELEASE_COMMIT}" ]] ||
    fail "the recorded release image reference is invalid"
  require_image_id "${RUSKI_RELEASE_IMAGE_ID}"
  [[ "${RUSKI_ROLLBACK_API_IMAGE}" =~ ^ruski-report-api:rollback-[0-9a-f]{64}$ ]] ||
    fail "the recorded rollback image reference is invalid"
  require_image_id "${RUSKI_ROLLBACK_IMAGE_ID}"
  [[ "${RUSKI_ROLLBACK_API_IMAGE}" == "ruski-report-api:rollback-${RUSKI_ROLLBACK_IMAGE_ID#sha256:}" ]] ||
    fail "the rollback reference does not match its immutable image ID"
  [[ "${RUSKI_RELEASE_PREPARED_AT}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]] ||
    fail "the recorded preparation time is invalid"
}

verify_state() {
  local state_file=$1
  local resolved_commit
  local release_id
  local rollback_id
  local revision

  load_state "${state_file}"
  resolved_commit=$(resolve_candidate_commit "${RUSKI_RELEASE_SOURCE_REF}")
  [[ "${resolved_commit}" == "${RUSKI_RELEASE_COMMIT}" ]] ||
    fail "the recorded source reference no longer resolves to the candidate"
  require_clean_candidate "${RUSKI_RELEASE_COMMIT}"

  release_id=$(image_id_for "${RUSKI_API_IMAGE}") ||
    fail "the prepared release image is unavailable"
  require_image_id "${release_id}"
  [[ "${release_id}" == "${RUSKI_RELEASE_IMAGE_ID}" ]] ||
    fail "the prepared release image no longer matches the recorded image ID"

  revision=$(image_revision_for "${RUSKI_API_IMAGE}") ||
    fail "the prepared release image revision could not be read"
  [[ "${revision}" == "${RUSKI_RELEASE_COMMIT}" ]] ||
    fail "the prepared release image revision does not match the candidate"

  rollback_id=$(image_id_for "${RUSKI_ROLLBACK_API_IMAGE}") ||
    fail "the preserved rollback image is unavailable"
  require_image_id "${rollback_id}"
  [[ "${rollback_id}" == "${RUSKI_ROLLBACK_IMAGE_ID}" ]] ||
    fail "the preserved rollback image no longer matches the recorded image ID"
}

verify_container() {
  local role=$1
  local state_file=$2
  local container=$3
  local actual_id
  local expected_id

  verify_state "${state_file}"
  case "${role}" in
    release) expected_id=${RUSKI_RELEASE_IMAGE_ID} ;;
    rollback) expected_id=${RUSKI_ROLLBACK_IMAGE_ID} ;;
    *) fail "the container role must be release or rollback" ;;
  esac
  actual_id=$(docker inspect --format '{{.Image}}' "${container}" 2>/dev/null) ||
    fail "the running container image ID could not be read"
  require_image_id "${actual_id}"
  [[ "${actual_id}" == "${expected_id}" ]] ||
    fail "the running container does not use the recorded ${role} image"
  printf 'status=container-verified\n'
  printf 'containerRole=%s\n' "${role}"
  printf 'containerImageId=%s\n' "${actual_id}"
}

prepare_image() {
  local candidate_ref=$1
  local state_file=$2
  local compose_env=${RUSKI_COMPOSE_ENV_FILE:-${deployment_dir}/.env}
  local compose_file=${deployment_dir}/compose.yml
  local commit
  local api_container
  local previous_id
  local release_image
  local release_id
  local rollback_image
  local rollback_id
  local revision
  local prepared_at
  local state_parent

  [[ "${state_file}" = /* ]] ||
    fail "the release image state path must be absolute"
  case "${state_file}" in
    "${repository_root}"|"${repository_root}"/*)
      fail "the release image state must be outside the Git repository"
      ;;
  esac
  [[ ! -e "${state_file}" ]] ||
    fail "the release image state already exists; verify it instead of rebuilding"
  state_parent=$(dirname -- "${state_file}")
  [[ -d "${state_parent}" && -w "${state_parent}" ]] ||
    fail "the release image state directory is unavailable"
  [[ -r "${compose_env}" ]] ||
    fail "the Compose environment file is unavailable"
  [[ -r "${compose_file}" ]] ||
    fail "the Compose project file is unavailable"

  commit=$(resolve_candidate_commit "${candidate_ref}")
  require_clean_candidate "${commit}"

  api_container=$(docker compose --file "${compose_file}" \
    --env-file "${compose_env}" ps -q api 2>/dev/null) ||
    fail "the currently deployed API container could not be resolved"
  [[ "${api_container}" =~ ^[0-9a-f]{12,64}$ ]] ||
    fail "a single running API container is required to preserve rollback"
  previous_id=$(docker inspect --format '{{.Image}}' "${api_container}" 2>/dev/null) ||
    fail "the currently deployed API image ID could not be read"
  require_image_id "${previous_id}"

  rollback_image="ruski-report-api:rollback-${previous_id#sha256:}"
  if rollback_id=$(image_id_for "${rollback_image}"); then
    require_image_id "${rollback_id}"
    [[ "${rollback_id}" == "${previous_id}" ]] ||
      fail "the rollback image reference already points to different content"
  else
    docker image tag "${previous_id}" "${rollback_image}" ||
      fail "the previous API image could not be preserved"
  fi

  release_image="ruski-report-api:phase7-${commit}"
  if docker image inspect "${release_image}" >/dev/null 2>&1; then
    fail "the release image reference already exists; do not rebuild it"
  fi

  docker build --pull --target runtime \
    --label "org.opencontainers.image.revision=${commit}" \
    --tag "${release_image}" \
    --file "${repository_root}/backend/Dockerfile" \
    "${repository_root}/backend" ||
    fail "the release image build failed"

  release_id=$(image_id_for "${release_image}") ||
    fail "the built release image ID could not be read"
  require_image_id "${release_id}"
  revision=$(image_revision_for "${release_image}") ||
    fail "the built release image revision could not be read"
  [[ "${revision}" == "${commit}" ]] ||
    fail "the built release image does not carry the candidate revision"

  prepared_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  umask 077
  temporary_state_file=$(mktemp "${state_parent}/.prepare-release-image.XXXXXX")
  {
    printf 'RUSKI_RELEASE_SCHEMA_VERSION=1\n'
    printf 'RUSKI_RELEASE_COMMIT=%s\n' "${commit}"
    printf 'RUSKI_RELEASE_SOURCE_REF=%s\n' "${candidate_ref}"
    printf 'RUSKI_API_IMAGE=%s\n' "${release_image}"
    printf 'RUSKI_RELEASE_IMAGE_ID=%s\n' "${release_id}"
    printf 'RUSKI_ROLLBACK_API_IMAGE=%s\n' "${rollback_image}"
    printf 'RUSKI_ROLLBACK_IMAGE_ID=%s\n' "${previous_id}"
    printf 'RUSKI_RELEASE_PREPARED_AT=%s\n' "${prepared_at}"
  } >"${temporary_state_file}"
  chmod 0600 "${temporary_state_file}"
  mv -- "${temporary_state_file}" "${state_file}"
  temporary_state_file=

  load_state "${state_file}"
  print_summary prepared
}

usage() {
  printf '%s\n' \
    'Usage:' \
    '  prepare-release-image.sh prepare CANDIDATE_COMMIT_OR_TAG STATE_FILE' \
    '  prepare-release-image.sh verify STATE_FILE' \
    '  prepare-release-image.sh release-ref STATE_FILE' \
    '  prepare-release-image.sh rollback-ref STATE_FILE' \
    '  prepare-release-image.sh verify-container ROLE STATE_FILE CONTAINER' >&2
  exit 2
}

for required_command in git docker date dirname mktemp mv chmod rm stat; do
  require_command "${required_command}"
done

case "${1:-}" in
  prepare)
    [[ $# -eq 3 ]] || usage
    prepare_image "$2" "$3"
    ;;
  verify)
    [[ $# -eq 2 ]] || usage
    verify_state "$2"
    print_summary verified
    ;;
  release-ref)
    [[ $# -eq 2 ]] || usage
    verify_state "$2"
    printf '%s\n' "${RUSKI_API_IMAGE}"
    ;;
  rollback-ref)
    [[ $# -eq 2 ]] || usage
    verify_state "$2"
    printf '%s\n' "${RUSKI_ROLLBACK_API_IMAGE}"
    ;;
  verify-container)
    [[ $# -eq 4 ]] || usage
    verify_container "$2" "$3" "$4"
    ;;
  *) usage ;;
esac
