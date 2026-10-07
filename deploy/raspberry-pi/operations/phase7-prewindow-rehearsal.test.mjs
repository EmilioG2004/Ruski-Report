import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL(
  "./phase7-prewindow-rehearsal.sh", import.meta.url
), "utf8");

test("uses a dedicated internal network and never joins a production network", () => {
  assert.match(script, /docker network create --internal/u);
  assert.doesNotMatch(script, /database_network/u);
  assert.doesNotMatch(script, /NetworkSettings\.Networks.*production_postgres/su);
  assert.match(script, /--network "\$\{network_name\}"/u);
});

test("pins candidate and rollback containers to immutable image IDs", () => {
  assert.match(script, /candidate_image_id/u);
  assert.match(script, /rollback_image_id/u);
  assert.match(script, /start_api candidate "\$\{candidate_image_id\}"/u);
  assert.match(script, /start_api rollback "\$\{rollback_image_id\}"/u);
  assert.doesNotMatch(script, /start_api (candidate|rollback).*RUSKI_API_IMAGE/u);
});

test("requires an exact snapshot and performs rollback from a fresh restore", () => {
  assert.match(script, /snapshot_id.*\^\[a-f0-9\]\{64\}\$/u);
  assert.doesNotMatch(script, /snapshot=\$\{1:-latest\}/u);
  const stop = script.indexOf("stop_database\nrollback_started=");
  const freshRollback = script.indexOf("start_database rollback", stop);
  const rollbackApi = script.indexOf("start_api rollback", freshRollback);
  assert.ok(stop > 0 && freshRollback > stop && rollbackApi > freshRollback);
});

test("guards cleanup with per-run labels and emits allowlisted evidence", () => {
  assert.match(script, /com\.ruskireport\.phase7\.rehearsal/u);
  assert.match(script, /labeled_container_leak/u);
  assert.match(script, /"cleanup":"passed"/u);
  assert.doesNotMatch(script, /docker (system|image|volume) prune/u);
  assert.doesNotMatch(script, /docker compose .* down/u);
});
