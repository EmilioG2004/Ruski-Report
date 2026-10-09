import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const sourceScript = join(testDirectory, "prepare-release-image.sh");
const commit = "a".repeat(40);
const previousImageId = `sha256:${"b".repeat(64)}`;
const releaseImageId = `sha256:${"c".repeat(64)}`;

test("prepares one candidate image and verifies the recorded immutable IDs", () => {
  const fixture = createFixture();
  const prepared = runScript(fixture, ["prepare", commit, fixture.stateFile]);

  assert.equal(prepared.status, 0, prepared.stderr);
  assert.match(prepared.stdout, /status=prepared/u);
  assert.match(prepared.stdout, new RegExp(`releaseCommit=${commit}`, "u"));
  assert.match(prepared.stdout, new RegExp(`releaseImageId=${releaseImageId}`, "u"));
  assert.match(prepared.stdout, new RegExp(`rollbackImageId=${previousImageId}`, "u"));

  const state = readFileSync(fixture.stateFile, "utf8");
  assert.match(state, new RegExp(`RUSKI_RELEASE_COMMIT=${commit}`, "u"));
  assert.match(state, new RegExp(`RUSKI_RELEASE_IMAGE_ID=${releaseImageId}`, "u"));
  assert.match(state, new RegExp(`RUSKI_ROLLBACK_IMAGE_ID=${previousImageId}`, "u"));
  assert.doesNotMatch(state, /repository|stateFile|POSTGRES|TOKEN|PASSWORD/iu);

  const commands = readFileSync(fixture.dockerLog, "utf8");
  assert.match(
    commands,
    /compose --file .*\/deploy\/raspberry-pi\/compose\.yml --env-file .*\/.env ps -q api/u
  );
  assert.match(commands, /image tag sha256:b{64} ruski-report-api:rollback-b{64}/u);
  assert.match(commands, /build --pull --target runtime/u);
  assert.match(commands, new RegExp(`org.opencontainers.image.revision=${commit}`, "u"));

  const verified = runScript(fixture, ["verify", fixture.stateFile]);
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(verified.stdout, /status=verified/u);

  const releaseRef = runScript(fixture, ["release-ref", fixture.stateFile]);
  assert.equal(releaseRef.status, 0, releaseRef.stderr);
  assert.equal(releaseRef.stdout.trim(), `ruski-report-api:phase7-${commit}`);

  const running = runScript(fixture, [
    "verify-container", "release", fixture.stateFile, "release-container"
  ]);
  assert.equal(running.status, 0, running.stderr);
  assert.match(running.stdout, /status=container-verified/u);
  assert.match(running.stdout, new RegExp(`containerImageId=${releaseImageId}`, "u"));

  const secondPrepare = runScript(fixture, ["prepare", commit, fixture.stateFile]);
  assert.notEqual(secondPrepare.status, 0);
  assert.match(secondPrepare.stderr, /already exists; verify it instead of rebuilding/u);
  const finalCommands = readFileSync(fixture.dockerLog, "utf8");
  assert.equal((finalCommands.match(/^build /gmu) ?? []).length, 1);
});

test("rejects a dirty worktree before inspecting or building images", () => {
  const fixture = createFixture({ dirty: true });
  const result = runScript(fixture, ["prepare", commit, fixture.stateFile]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /worktree is dirty/u);
  assert.equal(readFileSync(fixture.dockerLog, "utf8"), "");
});

test("rejects a candidate that differs from the checked-out commit", () => {
  const fixture = createFixture({ resolvedCommit: "d".repeat(40) });
  const result = runScript(fixture, ["prepare", "d".repeat(40), fixture.stateFile]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checked-out commit does not match/u);
  assert.equal(readFileSync(fixture.dockerLog, "utf8"), "");
});

test("verification fails closed when a release tag resolves to different content", () => {
  const fixture = createFixture();
  const prepared = runScript(fixture, ["prepare", commit, fixture.stateFile]);
  assert.equal(prepared.status, 0, prepared.stderr);

  const result = runScript(fixture, ["verify", fixture.stateFile], {
    MOCK_RELEASE_IMAGE_ID: `sha256:${"e".repeat(64)}`
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no longer matches the recorded image ID/u);
});

test("verification rejects a state file whose permissions are broader than 0600", () => {
  const fixture = createFixture();
  const prepared = runScript(fixture, ["prepare", commit, fixture.stateFile]);
  assert.equal(prepared.status, 0, prepared.stderr);
  chmodSync(fixture.stateFile, 0o640);

  const result = runScript(fixture, ["verify", fixture.stateFile]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /state must have mode 0600/u);
});

function createFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), "ruski-release-image-test-"));
  const repository = join(root, "repository");
  const operations = join(repository, "deploy", "raspberry-pi", "operations");
  const mockBin = join(root, "bin");
  const mockState = join(root, "mock-state");
  mkdirSync(operations, { recursive: true });
  mkdirSync(join(repository, "backend"), { recursive: true });
  mkdirSync(mockBin, { recursive: true });
  mkdirSync(mockState, { recursive: true });
  symlinkSync(sourceScript, join(operations, "prepare-release-image.sh"));
  writeFileSync(join(repository, "backend", "Dockerfile"), "FROM scratch\n");
  writeFileSync(join(repository, "deploy", "raspberry-pi", "compose.yml"), "services: {}\n");
  writeFileSync(join(repository, "deploy", "raspberry-pi", ".env"), "RUSKI_API_IMAGE=old\n");

  const dockerLog = join(root, "docker.log");
  writeFileSync(dockerLog, "");
  writeExecutable(join(mockBin, "git"), gitMock());
  writeExecutable(join(mockBin, "docker"), dockerMock());

  return {
    script: join(operations, "prepare-release-image.sh"),
    stateFile: join(root, "release-image.env"),
    dockerLog,
    environment: {
      PATH: `${mockBin}:${process.env.PATH}`,
      MOCK_DOCKER_LOG: dockerLog,
      MOCK_DOCKER_STATE: mockState,
      MOCK_GIT_HEAD: commit,
      MOCK_GIT_DIRTY: options.dirty ? "1" : "0",
      MOCK_RESOLVED_COMMIT: options.resolvedCommit ?? commit,
      MOCK_PREVIOUS_IMAGE_ID: previousImageId,
      MOCK_RELEASE_IMAGE_ID: releaseImageId
    }
  };
}

function runScript(fixture, args, environment = {}) {
  return spawnSync("bash", [fixture.script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...fixture.environment, ...environment }
  });
}

function writeExecutable(path, contents) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function gitMock() {
  return `#!/usr/bin/env bash
set -eu
args="$*"
case "$args" in
  *"status --porcelain=v1"*)
    if [[ "\${MOCK_GIT_DIRTY}" == "1" ]]; then
      printf '?? private-file\\n'
    fi
    ;;
  *"rev-parse HEAD"*) printf '%s\\n' "\${MOCK_GIT_HEAD}" ;;
  *"rev-parse --verify"*) printf '%s\\n' "\${MOCK_RESOLVED_COMMIT}" ;;
  *) exit 2 ;;
esac
`;
}

function dockerMock() {
  return `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >>"\${MOCK_DOCKER_LOG}"
previous="\${MOCK_PREVIOUS_IMAGE_ID}"
release="\${MOCK_RELEASE_IMAGE_ID}"
state="\${MOCK_DOCKER_STATE}"
case "\${1:-} \${2:-}" in
  "compose --file")
    printf '%s\\n' "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
    ;;
  "inspect --format")
    if [[ "\${!#}" == "release-container" ]]; then
      printf '%s\\n' "$release"
    else
      printf '%s\\n' "$previous"
    fi
    ;;
  "image tag")
    : >"$state/rollback-tagged"
    ;;
  "image inspect")
    ref="\${!#}"
    if [[ "$ref" == ruski-report-api:rollback-* ]]; then
      [[ -f "$state/rollback-tagged" ]] || exit 1
      printf '%s\\n' "$previous"
    elif [[ "$ref" == ruski-report-api:phase7-* ]]; then
      [[ -f "$state/release-built" ]] || exit 1
      if [[ "$*" == *org.opencontainers.image.revision* ]]; then
        printf '%s\\n' "\${MOCK_GIT_HEAD}"
      else
        printf '%s\\n' "$release"
      fi
    else
      exit 1
    fi
    ;;
  "build --pull")
    : >"$state/release-built"
    ;;
  *) exit 2 ;;
esac
`;
}
