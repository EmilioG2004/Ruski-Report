/**
 * Runs every deterministic local release gate. PostgreSQL is mandatory here;
 * the suite fails clearly instead of letting Jest silently skip integration.
 */

import { loadQualificationConfiguration } from "./configuration.mjs";
import { runCommand } from "./process-runner.mjs";

export function runLocalQualification(environment = process.env) {
  const configuration = loadQualificationConfiguration(environment);
  const backendDirectory = `${configuration.repositoryRoot}/backend`;

  runCommand("npm", ["run", "lint"], {
    cwd: backendDirectory,
    environment,
    label: "backend TypeScript lint"
  });
  runCommand("npm", ["run", "build"], {
    cwd: backendDirectory,
    environment,
    label: "backend production build"
  });
  runCommand("npm", ["test"], {
    cwd: backendDirectory,
    environment,
    label: "backend unit suite"
  });

  if (environment.TEST_DATABASE_URL === undefined) {
    throw new Error(
      "TEST_DATABASE_URL is required for the PostgreSQL integration gate."
    );
  }
  runCommand("npm", ["run", "test:postgres"], {
    cwd: backendDirectory,
    environment,
    label: "backend PostgreSQL integration suite"
  });
  runCommand("node", [
    "--test",
    "scripts/release-qualification/configuration.test.mjs",
    "scripts/release-qualification/log-audit.test.mjs",
    "scripts/release-qualification/production-write.test.mjs",
    "backend/scripts/realtime-event-observer.test.mjs"
  ], {
    cwd: configuration.repositoryRoot,
    environment,
    label: "release qualification tool tests"
  });
  runCommand(`${configuration.repositoryRoot}/scripts/validate-ios-release.sh`, [], {
    cwd: configuration.repositoryRoot,
    environment,
    label: "iOS release configuration"
  });
  runCommand("node", ["scripts/validate-policy-site.mjs"], {
    cwd: configuration.repositoryRoot,
    environment,
    label: "public policy site"
  });
}
