import assert from "node:assert/strict";
import test from "node:test";

import {
  blockedExternalGateResults,
  createQualificationSummary
} from "./evidence.mjs";

const candidate = {
  commitSha: "a".repeat(40),
  dirty: false,
  toolVersions: { node: "22.18.0", git: "2.50.1" }
};

function summary(scope, gates, selectedCandidate = candidate) {
  return createQualificationSummary(scope, gates, {
    candidate: selectedCandidate,
    requiredGateIds: gates.map((gate) => gate.id)
  });
}

test("emits deterministic sanitized evidence", () => {
  const gates = [
    { id: "local", status: "passed", evidenceCode: "command_completed" },
    ...blockedExternalGateResults()
  ];
  const first = summary("local", gates);
  const second = summary("local", gates);

  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(first.counts, { passed: 1, failed: 0, blocked: 8 });
  assert.equal(first.releaseReady, false);
  assert.deepEqual(first.candidate, {
    commitSha: "a".repeat(40),
    dirty: false,
    toolVersions: { git: "2.50.1", node: "22.18.0" }
  });
  assert.doesNotMatch(
    JSON.stringify(first),
    /postgres(?:ql)?:\/\/|\/Users\/|"(?:authorization|cookie|token)"\s*:/iu
  );
});

test("rejects duplicate or unsafe evidence", () => {
  assert.throws(
    () => summary("local", [
      { id: "same", status: "passed", evidenceCode: "command_completed" },
      { id: "same", status: "blocked", evidenceCode: "external_required" }
    ]),
    /unique/u
  );
  assert.throws(
    () => summary("local", [
      { id: "gate", status: "passed", evidenceCode: "/private/path" }
    ]),
    /safe evidence code/u
  );
});

test("never marks a dirty candidate release-ready", () => {
  const result = summary("local", [{
    id: "commands",
    status: "passed",
    evidenceCode: "command_completed"
  }], {
    commitSha: "b".repeat(40),
    dirty: true,
    toolVersions: { node: "22.18.0" }
  });

  assert.equal(result.releaseReady, false);
});

test("requires candidate identity and the complete gate set", () => {
  const gates = [{
    id: "commands",
    status: "passed",
    evidenceCode: "command_completed"
  }];
  assert.throws(
    () => createQualificationSummary("local", gates, {
      requiredGateIds: ["commands"]
    }),
    /candidate identity/u
  );
  assert.throws(
    () => createQualificationSummary("local", gates, {
      candidate,
      requiredGateIds: ["commands", "missing-gate"]
    }),
    /complete required gate set/u
  );
});
