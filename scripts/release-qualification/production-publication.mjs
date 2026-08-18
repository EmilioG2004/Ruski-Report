/**
 * Qualifies rejection atomicity and then deliberately publishes the configured
 * workbook. Callers must enforce the production-write opt-in before invoking it.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { requireCondition } from "./http-client.mjs";

export async function qualifyProductionPublication(
  client,
  configuration,
  adminToken
) {
  const activeBefore = await readOptionalActiveTournament(client);
  const invalidStatus = await uploadInvalidWorkbook(
    client,
    configuration,
    adminToken
  );
  requireCondition(
    invalidStatus === 422,
    `Malformed workbook returned ${invalidStatus} instead of 422.`
  );
  const activeAfterRejection = await readOptionalActiveTournament(client);
  requireCondition(
    activeAfterRejection?.id === activeBefore?.id &&
      activeAfterRejection?.version === activeBefore?.version,
    "Rejected workbook changed the active snapshot."
  );

  const form = new FormData();
  form.set(
    "file",
    new Blob([readFileSync(configuration.scorebookPath)]),
    basename(configuration.scorebookPath)
  );
  const response = await client.post(uploadPath(configuration), form, {
    adminToken
  });
  requireCondition(
    response?.status === "published" && response?.validation?.valid === true,
    "Configured scorebook was not published successfully."
  );

  const active = await client.get("tournaments/active");
  requireCondition(
    active?.id === response.tournamentId &&
      active?.version === response.snapshotVersion?.version,
    "Published snapshot did not become the active tournament."
  );
  return { tournamentId: active.id, version: active.version };
}

async function readOptionalActiveTournament(client) {
  const status = await client.status("tournaments/active", { method: "GET" });
  if (status === 404) return undefined;
  requireCondition(status === 200, `Active tournament returned ${status}.`);
  return client.get("tournaments/active");
}

async function uploadInvalidWorkbook(client, configuration, adminToken) {
  const form = new FormData();
  form.set("file", new Blob(["not an xlsx workbook"]), "malformed.xlsx");
  return client.status(uploadPath(configuration), {
    method: "POST",
    body: form,
    adminToken
  });
}

function uploadPath(configuration) {
  return (
    `admin/tournaments/${configuration.tournamentYear}/upload-scorebook?` +
    `gameType=${encodeURIComponent(configuration.gameType)}`
  );
}
