/**
 * Ordered local gates. Commands are intentionally explicit so review can map
 * each executable slice to the Phase 7 lifecycle requirement.
 */

const lifecycleContracts = [
  "src/tournament-engine/qualification/full-lifecycle.trace.spec.ts",
  "src/admin/tournament-setup/admin-tournament-setup.service.spec.ts",
  "src/admin/tournament-workbooks/admin-tournament-workbook.service.spec.ts",
  "src/tournament-engine/workbook/generation/canonical-workbook.generator.spec.ts",
  "src/tournament-engine/workbook/reconciliation/canonical-workbook.parser.spec.ts",
  "src/tournament-engine/workbook/reconciliation/workbook-apply.planner.spec.ts",
  "src/tournament-engine/scoring/workbook-candidate.adapter.spec.ts",
  "src/tournament-engine/statistics/canonical-statistics.spec.ts",
  "src/tournament-engine/standings/pod-standings.spec.ts",
  "src/tournament-engine/seeding/global-qualifier-seeding.spec.ts",
  "src/tournament-engine/bracket/mirrored-bracket.spec.ts",
  "src/admin/tournament-progression/admin-tournament-progression.service.spec.ts",
  "src/tournament-engine/public-projection/public-projection.contracts.spec.ts",
  "src/public-api/v2/public-v2.service.spec.ts",
  "src/realtime/realtime-update.publisher.spec.ts"
];

export const LOCAL_QUALIFICATION_GATES = Object.freeze([
  backendGate("backend-lint", "backend TypeScript lint", ["run", "lint"]),
  backendGate("backend-build", "backend production build", ["run", "build"]),
  backendGate(
    "backend-unit",
    "complete backend unit suite",
    ["test", "--", "--testPathIgnorePatterns=integration\\.spec\\.ts$"]
  ),
  backendGate(
    "lifecycle-contracts",
    "pure setup-to-champion contract trace and supporting focused suites",
    ["test", "--", "--runTestsByPath", ...lifecycleContracts]
  ),
  backendGate(
    "projection-realtime-transaction",
    "production-wired projection and realtime transaction regression",
    [
      "test",
      "--",
      "--runTestsByPath",
      "src/tournament-engine/qualification/production-wiring.spec.ts",
      "src/tournament-engine/persistence/postgres-projection.repository.integration.spec.ts"
    ]
  ),
  backendGate(
    "postgres-integration",
    "complete PostgreSQL migration and integration suite",
    ["run", "test:postgres"]
  ),
  {
    id: "qualification-tools",
    label: "release qualification tool tests",
    cwd: "repository",
    command: "node",
    args: [
      "--test",
      "scripts/release-qualification/candidate-identity.test.mjs",
      "scripts/release-qualification/configuration.test.mjs",
      "scripts/release-qualification/database-guard.test.mjs",
      "scripts/release-qualification/evidence.test.mjs",
      "scripts/release-qualification/log-audit.test.mjs",
      "scripts/release-qualification/public-equivalence.test.mjs",
      "scripts/release-qualification/production-write.test.mjs",
      "backend/scripts/realtime-event-observer.test.mjs"
    ]
  },
  {
    id: "ios-release-configuration",
    label: "iOS release configuration",
    cwd: "repository",
    command: "scripts/validate-ios-release.sh",
    args: []
  },
  {
    id: "policy-site",
    label: "public policy site",
    cwd: "repository",
    command: "node",
    args: ["scripts/validate-policy-site.mjs"]
  }
]);

function backendGate(id, label, args) {
  return { id, label, cwd: "backend", command: "npm", args };
}
