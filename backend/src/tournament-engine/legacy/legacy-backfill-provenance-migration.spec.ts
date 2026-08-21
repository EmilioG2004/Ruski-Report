import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("0013 legacy backfill provenance migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "migrations/0013_legacy_backfill_provenance.sql"),
    "utf8"
  );

  it("keeps canonical and legacy bracket provenance mutually exclusive", () => {
    expect(sql).toContain("provenance_kind IN ('canonical', 'legacy_backfill')");
    expect(sql).toMatch(
      /provenance_kind = 'canonical'[\s\S]*legacy_backfill_run_id IS NULL[\s\S]*cumulative_workbook_id IS NOT NULL[\s\S]*published_by_admin_id IS NOT NULL/
    );
    expect(sql).toMatch(
      /provenance_kind = 'legacy_backfill'[\s\S]*legacy_backfill_run_id IS NOT NULL[\s\S]*cumulative_workbook_id IS NULL[\s\S]*published_by_admin_id IS NULL/
    );
    expect(sql).toMatch(
      /engine_bracket_resolutions_provenance_consistent[\s\S]*resolved_by_admin_id IS NOT NULL[\s\S]*resolved_by_admin_id IS NULL/
    );
    expect(sql).toMatch(
      /engine_pod_finalization_provenance_consistent[\s\S]*finalized_by_admin_id IS NOT NULL[\s\S]*finalized_by_admin_id IS NULL/
    );
    expect(sql).toMatch(
      /engine_bracket_advancements_provenance_consistent[\s\S]*advanced_by_admin_id IS NOT NULL[\s\S]*advanced_by_admin_id IS NULL/
    );
  });

  it("requires completed linked v2 backfill provenance at commit", () => {
    expect(sql).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(sql).toContain("run.status = 'completed'");
    expect(sql).toContain("run.tool_version >= 2");
    expect(sql).toContain("engine_legacy_tournament_links");
    expect(sql).toContain("tournament.year = 2026");
  });

  it("requires the active legacy revision from the same run and snapshot", () => {
    expect(sql).toContain("match.active_revision_id = revision.id");
    expect(sql).toContain("revision.source_adapter = 'legacy_backfill'");
    expect(sql).toContain(
      "revision.metadata ->> 'legacyBackfillRunId' = run.id::text"
    );
    expect(sql).toMatch(
      /revision\.metadata ->> 'sourceSnapshotVersion'[\s\S]*run\.source_snapshot_version::text/
    );
    expect(sql).toContain("active.snapshot_version = run.source_snapshot_version");
  });

  it("guards legacy pod-finalization and bracket-advancement authority", () => {
    expect(sql).toContain("engine_validate_legacy_pod_finalization_provenance");
    expect(sql).toContain("engine_validate_legacy_bracket_advancement");
    expect(sql).toContain("engine_active_bracket_match_resolutions");
    expect(sql).toContain("destination.source_type = 'match_winner'");
  });

  it("does not fabricate a canonical workbook or administrator", () => {
    expect(sql).not.toMatch(/INSERT\s+INTO\s+admin_accounts/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+engine_generated_workbooks/i);
  });
});
