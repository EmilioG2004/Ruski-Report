/** Runs the ordered local manifest and returns deterministic gate evidence. */

import { loadQualificationConfiguration } from "./configuration.mjs";
import { readCandidateIdentity } from "./candidate-identity.mjs";
import { requireDisposableDatabasePair } from "./database-guard.mjs";
import {
  blockedExternalGateResults,
  createQualificationSummary,
  EXTERNAL_RELEASE_GATES
} from "./evidence.mjs";
import { LOCAL_QUALIFICATION_GATES } from "./local-manifest.mjs";
import { runCommand } from "./process-runner.mjs";

export function runLocalQualification(
  environment = process.env,
  execute = runCommand
) {
  const configuration = loadQualificationConfiguration(environment);
  requireDisposableDatabasePair(environment);
  const candidate = readCandidateIdentity(configuration.repositoryRoot);
  const backendDirectory = `${configuration.repositoryRoot}/backend`;
  const results = LOCAL_QUALIFICATION_GATES.map((gate) => {
    try {
      execute(resolveCommand(gate.command, configuration.repositoryRoot), gate.args, {
        cwd: gate.cwd === "backend"
          ? backendDirectory
          : configuration.repositoryRoot,
        environment,
        label: gate.label
      });
      return {
        id: gate.id,
        status: "passed",
        evidenceCode: "command_completed"
      };
    } catch {
      return {
        id: gate.id,
        status: "failed",
        evidenceCode: "command_failed"
      };
    }
  });

  return createQualificationSummary("local", [
    {
      id: "candidate-worktree",
      status: candidate.dirty ? "failed" : "passed",
      evidenceCode: candidate.dirty ? "worktree_dirty" : "worktree_clean"
    },
    ...results,
    ...blockedExternalGateResults()
  ], {
    candidate,
    requiredGateIds: [
      "candidate-worktree",
      ...LOCAL_QUALIFICATION_GATES.map((gate) => gate.id),
      ...EXTERNAL_RELEASE_GATES.map((gate) => gate.id)
    ]
  });
}

function resolveCommand(command, repositoryRoot) {
  return command.startsWith("scripts/") ? `${repositoryRoot}/${command}` : command;
}
