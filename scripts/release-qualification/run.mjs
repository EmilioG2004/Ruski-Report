#!/usr/bin/env node

/** Dispatches small release checks behind one documented operator command. */

import { runLocalQualification } from "./local-suite.mjs";
import { runProductionReadQualification } from "./production-read.mjs";
import { fileURLToPath } from "node:url";

const command = process.argv[2];

switch (command) {
  case "local":
    runLocalQualification();
    console.log("\nLocal release qualification passed.");
    break;
  case "production-read": {
    const result = await runProductionReadQualification();
    console.log("Production read qualification passed.");
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  case "production-write": {
    const { runProductionWriteQualification } = await import(
      "./production-write.mjs"
    );
    const result = await runProductionWriteQualification();
    console.log("Production write qualification passed.");
    console.log(JSON.stringify(result, null, 2));
    break;
  }
  case "logs": {
    const logPath = process.argv[3];
    if (logPath === undefined) usage();
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("log-audit.mjs", import.meta.url)), logPath],
      { stdio: "inherit" }
    );
    process.exit(result.status ?? 1);
  }
  default:
    usage();
}

function usage() {
  console.error(
    "Usage: node scripts/release-qualification/run.mjs " +
      "<local|production-read|production-write|logs LOG_FILE>"
  );
  process.exit(2);
}
