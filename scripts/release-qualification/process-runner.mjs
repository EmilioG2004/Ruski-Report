/** Runs qualification subprocesses with inherited output and consistent errors. */

import { spawnSync } from "node:child_process";

export function runCommand(command, args, options = {}) {
  console.log(`\n[qualification] ${options.label ?? command}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.environment ?? process.env,
    stdio: "inherit"
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${options.label ?? command} failed with exit ${result.status}.`);
  }
}
