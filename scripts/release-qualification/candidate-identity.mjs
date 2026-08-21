/** Reads release identity without retaining worktree paths or changed names. */

import { spawnSync } from "node:child_process";

export function readCandidateIdentity(repositoryRoot, execute = spawnSync) {
  const commitSha = commandOutput(
    execute,
    "git",
    ["rev-parse", "HEAD"],
    repositoryRoot
  );
  if (!/^[a-f0-9]{40,64}$/u.test(commitSha)) {
    throw new Error("Candidate commit SHA is unavailable.");
  }
  const porcelain = commandOutput(
    execute,
    "git",
    ["status", "--porcelain", "--untracked-files=normal"],
    repositoryRoot,
    true
  );
  const gitVersion = commandOutput(
    execute,
    "git",
    ["--version"],
    repositoryRoot
  ).replace(/^git version\s+/u, "").split(/\s/u)[0];

  return {
    commitSha,
    dirty: porcelain.length > 0,
    toolVersions: {
      node: process.versions.node,
      git: gitVersion
    }
  };
}

function commandOutput(execute, command, args, cwd, allowEmpty = false) {
  const result = execute(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error("Candidate identity command failed.");
  }
  const output = String(result.stdout ?? "").trim();
  if (!allowEmpty && output.length === 0) {
    throw new Error("Candidate identity command returned no output.");
  }
  return output;
}
