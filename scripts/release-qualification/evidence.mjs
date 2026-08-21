/** Deterministic, privacy-safe evidence shared by qualification commands. */

export const QUALIFICATION_STATUSES = Object.freeze([
  "passed",
  "failed",
  "blocked"
]);

export const EXTERNAL_RELEASE_GATES = Object.freeze([
  { id: "production-backup-restore", reasonCode: "production_evidence_required" },
  { id: "restored-end-to-end-lifecycle", reasonCode: "restored_environment_required" },
  { id: "production-migration-apply", reasonCode: "production_authorization_required" },
  { id: "production-v1-v2-equivalence", reasonCode: "production_evidence_required" },
  { id: "production-log-window", reasonCode: "production_evidence_required" },
  { id: "ios-simulator-compact", reasonCode: "simulator_evidence_required" },
  { id: "ios-simulator-large", reasonCode: "simulator_evidence_required" },
  { id: "ios-physical-device", reasonCode: "device_evidence_required" }
]);

export function blockedExternalGateResults() {
  return EXTERNAL_RELEASE_GATES.map((gate) => ({
    id: gate.id,
    status: "blocked",
    evidenceCode: gate.reasonCode
  }));
}

export function createQualificationSummary(scope, gates, options = {}) {
  if (typeof scope !== "string" || !/^[a-z0-9-]+$/u.test(scope)) {
    throw new Error("Qualification scope must be a stable identifier.");
  }
  const normalized = gates.map(normalizeGate);
  const identifiers = normalized.map((gate) => gate.id);
  if (new Set(identifiers).size !== identifiers.length) {
    throw new Error("Qualification gate identifiers must be unique.");
  }
  const candidate = normalizeCandidate(options.candidate);
  const requiredGateIds = normalizeRequiredGateIds(options.requiredGateIds);
  if (
    identifiers.length !== requiredGateIds.length ||
    identifiers.some((identifier) => !requiredGateIds.includes(identifier))
  ) {
    throw new Error("Qualification evidence must include the complete required gate set.");
  }

  const counts = Object.fromEntries(
    QUALIFICATION_STATUSES.map((status) => [
      status,
      normalized.filter((gate) => gate.status === status).length
    ])
  );
  return {
    schemaVersion: 1,
    scope,
    candidate,
    gates: normalized,
    counts,
    releaseReady:
      counts.failed === 0 && counts.blocked === 0 && candidate.dirty === false
  };
}

function normalizeRequiredGateIds(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Qualification evidence requires an explicit gate set.");
  }
  const identifiers = value.map((identifier) => {
    if (typeof identifier !== "string" || !/^[a-z0-9-]+$/u.test(identifier)) {
      throw new Error("Required qualification gate identifiers are invalid.");
    }
    return identifier;
  });
  if (new Set(identifiers).size !== identifiers.length) {
    throw new Error("Required qualification gate identifiers must be unique.");
  }
  return identifiers;
}

function normalizeCandidate(candidate) {
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    typeof candidate.commitSha !== "string" ||
    !/^[a-f0-9]{40,64}$/u.test(candidate.commitSha) ||
    typeof candidate.dirty !== "boolean" ||
    candidate.toolVersions === null ||
    typeof candidate.toolVersions !== "object"
  ) {
    throw new Error("Qualification candidate identity is invalid.");
  }
  const toolVersions = Object.fromEntries(
    Object.entries(candidate.toolVersions).sort(([left], [right]) =>
      left.localeCompare(right)
    ).map(([name, version]) => {
      if (!/^[a-z0-9-]+$/u.test(name) ||
          typeof version !== "string" ||
          !/^[a-zA-Z0-9.+_-]+$/u.test(version)) {
        throw new Error("Qualification tool version is invalid.");
      }
      return [name, version];
    })
  );
  return {
    commitSha: candidate.commitSha,
    dirty: candidate.dirty,
    toolVersions
  };
}

function normalizeGate(gate) {
  if (gate === null || typeof gate !== "object") {
    throw new Error("Qualification gates must be objects.");
  }
  if (typeof gate.id !== "string" || !/^[a-z0-9-]+$/u.test(gate.id)) {
    throw new Error("Qualification gate identifiers must be stable identifiers.");
  }
  if (!QUALIFICATION_STATUSES.includes(gate.status)) {
    throw new Error(`Unknown qualification status for '${gate.id}'.`);
  }
  if (
    typeof gate.evidenceCode !== "string" ||
    !/^[a-z0-9_]+$/u.test(gate.evidenceCode)
  ) {
    throw new Error(`Qualification gate '${gate.id}' needs a safe evidence code.`);
  }
  return {
    id: gate.id,
    status: gate.status,
    evidenceCode: gate.evidenceCode
  };
}
