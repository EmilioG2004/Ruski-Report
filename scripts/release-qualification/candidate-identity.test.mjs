import assert from "node:assert/strict";
import test from "node:test";

import { readCandidateIdentity } from "./candidate-identity.mjs";

test("records safe candidate identity without changed paths", () => {
  const execute = (command, args) => {
    const key = `${command} ${args.join(" ")}`;
    const outputs = new Map([
      ["git rev-parse HEAD", `${"a".repeat(40)}\n`],
      ["git status --porcelain --untracked-files=normal", " M private/file\n"],
      ["git --version", "git version 2.50.0\n"]
    ]);
    return { status: 0, stdout: outputs.get(key) ?? "" };
  };
  const identity = readCandidateIdentity("/not-emitted", execute);

  assert.deepEqual(identity, {
    commitSha: "a".repeat(40),
    dirty: true,
    toolVersions: { node: process.versions.node, git: "2.50.0" }
  });
  assert.doesNotMatch(JSON.stringify(identity), /private\/file|not-emitted/u);
});
