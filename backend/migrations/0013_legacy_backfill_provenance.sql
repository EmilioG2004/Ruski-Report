ALTER TABLE engine_bracket_publications
  ADD COLUMN provenance_kind text NOT NULL DEFAULT 'canonical',
  ADD COLUMN legacy_backfill_run_id uuid
    REFERENCES engine_legacy_backfill_runs(id) ON DELETE RESTRICT;

ALTER TABLE engine_bracket_publications
  ALTER COLUMN cumulative_workbook_id DROP NOT NULL,
  ALTER COLUMN published_by_admin_id DROP NOT NULL,
  ADD CONSTRAINT engine_bracket_publications_provenance_kind_valid CHECK (
    provenance_kind IN ('canonical', 'legacy_backfill')
  ),
  ADD CONSTRAINT engine_bracket_publications_provenance_consistent CHECK (
    (
      provenance_kind = 'canonical'
      AND legacy_backfill_run_id IS NULL
      AND cumulative_workbook_id IS NOT NULL
      AND published_by_admin_id IS NOT NULL
    ) OR (
      provenance_kind = 'legacy_backfill'
      AND legacy_backfill_run_id IS NOT NULL
      AND cumulative_workbook_id IS NULL
      AND published_by_admin_id IS NULL
      AND seed_override_command_id IS NULL
    )
  );

ALTER TABLE engine_bracket_match_resolutions
  ADD COLUMN provenance_kind text NOT NULL DEFAULT 'canonical',
  ADD COLUMN legacy_backfill_run_id uuid
    REFERENCES engine_legacy_backfill_runs(id) ON DELETE RESTRICT;

ALTER TABLE engine_bracket_match_resolutions
  ALTER COLUMN resolved_by_admin_id DROP NOT NULL,
  ADD CONSTRAINT engine_bracket_resolutions_provenance_kind_valid CHECK (
    provenance_kind IN ('canonical', 'legacy_backfill')
  ),
  ADD CONSTRAINT engine_bracket_resolutions_provenance_consistent CHECK (
    (
      provenance_kind = 'canonical'
      AND legacy_backfill_run_id IS NULL
      AND resolved_by_admin_id IS NOT NULL
    ) OR (
      provenance_kind = 'legacy_backfill'
      AND legacy_backfill_run_id IS NOT NULL
      AND resolved_by_admin_id IS NULL
    )
  );

ALTER TABLE engine_pod_finalization_provenance
  ADD COLUMN provenance_kind text NOT NULL DEFAULT 'canonical',
  ADD COLUMN legacy_backfill_run_id uuid
    REFERENCES engine_legacy_backfill_runs(id) ON DELETE RESTRICT;

ALTER TABLE engine_pod_finalization_provenance
  ALTER COLUMN finalized_by_admin_id DROP NOT NULL,
  ADD CONSTRAINT engine_pod_finalization_provenance_kind_valid CHECK (
    provenance_kind IN ('canonical', 'legacy_backfill')
  ),
  ADD CONSTRAINT engine_pod_finalization_provenance_consistent CHECK (
    (
      provenance_kind = 'canonical'
      AND legacy_backfill_run_id IS NULL
      AND finalized_by_admin_id IS NOT NULL
    ) OR (
      provenance_kind = 'legacy_backfill'
      AND legacy_backfill_run_id IS NOT NULL
      AND finalized_by_admin_id IS NULL
    )
  );

ALTER TABLE engine_bracket_advancements
  ADD COLUMN provenance_kind text NOT NULL DEFAULT 'canonical',
  ADD COLUMN legacy_backfill_run_id uuid
    REFERENCES engine_legacy_backfill_runs(id) ON DELETE RESTRICT;

ALTER TABLE engine_bracket_advancements
  ALTER COLUMN advanced_by_admin_id DROP NOT NULL,
  ADD CONSTRAINT engine_bracket_advancements_provenance_kind_valid CHECK (
    provenance_kind IN ('canonical', 'legacy_backfill')
  ),
  ADD CONSTRAINT engine_bracket_advancements_provenance_consistent CHECK (
    (
      provenance_kind = 'canonical'
      AND legacy_backfill_run_id IS NULL
      AND advanced_by_admin_id IS NOT NULL
    ) OR (
      provenance_kind = 'legacy_backfill'
      AND legacy_backfill_run_id IS NOT NULL
      AND advanced_by_admin_id IS NULL
    )
  );

CREATE INDEX engine_bracket_publications_legacy_run_idx
  ON engine_bracket_publications (legacy_backfill_run_id)
  WHERE legacy_backfill_run_id IS NOT NULL;

CREATE INDEX engine_bracket_resolutions_legacy_run_idx
  ON engine_bracket_match_resolutions (legacy_backfill_run_id)
  WHERE legacy_backfill_run_id IS NOT NULL;

CREATE INDEX engine_pod_finalization_provenance_legacy_run_idx
  ON engine_pod_finalization_provenance (legacy_backfill_run_id)
  WHERE legacy_backfill_run_id IS NOT NULL;

CREATE INDEX engine_bracket_advancements_legacy_run_idx
  ON engine_bracket_advancements (legacy_backfill_run_id)
  WHERE legacy_backfill_run_id IS NOT NULL;

CREATE OR REPLACE FUNCTION engine_validate_bracket_publication()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM engine_active_seed_calculations active_seed
    WHERE active_seed.tournament_id = NEW.tournament_id
      AND active_seed.calculation_id = NEW.seed_calculation_id
  ) OR NOT EXISTS (
    SELECT 1 FROM engine_bracket_matches node
    WHERE node.bracket_id = NEW.bracket_id
      AND node.tournament_id = NEW.tournament_id
  ) OR EXISTS (
    SELECT 1
    FROM engine_bracket_matches source
    JOIN engine_bracket_rounds source_round ON source_round.id = source.round_id
    LEFT JOIN engine_bracket_slots consumer
      ON consumer.source_type = 'match_winner'
     AND consumer.source_bracket_match_id = source.id
    WHERE source.bracket_id = NEW.bracket_id
      AND source_round.sequence < (
        SELECT max(round.sequence)
        FROM engine_bracket_rounds round
        WHERE round.bracket_id = NEW.bracket_id
      )
    GROUP BY source.id
    HAVING count(consumer.id) <> 1
  ) THEN
    RAISE EXCEPTION 'Bracket publication provenance is stale or incomplete.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.provenance_kind = 'canonical' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM engine_generated_workbooks workbook
      WHERE workbook.id = NEW.cumulative_workbook_id
        AND workbook.tournament_id = NEW.tournament_id
        AND workbook.generation_kind = 'playoffs_cumulative'
    ) OR NOT EXISTS (
      SELECT 1
      FROM engine_brackets bracket
      WHERE bracket.id = NEW.bracket_id
        AND bracket.tournament_id = NEW.tournament_id
        AND bracket.status = 'published'
        AND bracket.published_at = NEW.published_at
    ) OR NOT (
      (
        NEW.seed_override_command_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM engine_active_seed_override_commands active_override
          WHERE active_override.tournament_id = NEW.tournament_id
        )
      ) OR EXISTS (
        SELECT 1
        FROM engine_active_seed_override_commands active_override
        JOIN engine_seed_override_commands override_command
          ON override_command.id = active_override.command_id
        WHERE active_override.tournament_id = NEW.tournament_id
          AND active_override.command_id = NEW.seed_override_command_id
          AND override_command.calculation_id = NEW.seed_calculation_id
      )
    ) THEN
      RAISE EXCEPTION 'Bracket publication provenance is stale or incomplete.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM engine_legacy_backfill_runs run
    JOIN engine_tournaments tournament
      ON tournament.id = NEW.tournament_id
     AND tournament.public_key = run.legacy_tournament_id
    JOIN active_tournament_snapshots active
      ON active.tournament_id = run.legacy_tournament_id
     AND active.snapshot_version = run.source_snapshot_version
    JOIN tournament_snapshot_versions snapshot
      ON snapshot.tournament_id = active.tournament_id
     AND snapshot.version = active.snapshot_version
    JOIN engine_brackets bracket
      ON bracket.id = NEW.bracket_id
     AND bracket.tournament_id = NEW.tournament_id
    WHERE run.id = NEW.legacy_backfill_run_id
      AND run.status IN ('running', 'completed')
      AND run.tool_version >= 2
      AND tournament.year = 2026
      AND tournament.lifecycle = 'completed'
      AND tournament.visibility = 'public'
      AND snapshot.status = 'completed'
      AND bracket.status = 'completed'
      AND bracket.published_at = NEW.published_at
  ) THEN
    RAISE EXCEPTION 'Legacy bracket publication provenance is invalid.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION engine_validate_legacy_bracket_release_at_commit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  selected_run_id uuid;
  selected_tournament_id uuid;
BEGIN
  selected_run_id := NEW.legacy_backfill_run_id;
  selected_tournament_id := NEW.tournament_id;
  IF NEW.provenance_kind <> 'legacy_backfill' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM engine_legacy_backfill_runs run
    JOIN engine_legacy_tournament_links link
      ON link.backfill_run_id = run.id
     AND link.engine_tournament_id = selected_tournament_id
    WHERE run.id = selected_run_id
      AND run.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'Legacy bracket provenance requires a completed linked backfill.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION engine_validate_legacy_bracket_resolution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.provenance_kind <> 'legacy_backfill' THEN
    RETURN NEW;
  END IF;
  IF NEW.resolution_type <> 'match_result'
     OR NOT EXISTS (
       SELECT 1
       FROM engine_legacy_backfill_runs run
       JOIN engine_tournaments tournament
         ON tournament.id = NEW.tournament_id
        AND tournament.public_key = run.legacy_tournament_id
       JOIN engine_bracket_matches node
         ON node.id = NEW.bracket_match_id
        AND node.tournament_id = NEW.tournament_id
        AND node.match_id = NEW.match_id
       JOIN engine_match_revisions revision
         ON revision.id = NEW.revision_id
         AND revision.tournament_id = NEW.tournament_id
         AND revision.match_id = NEW.match_id
       JOIN engine_matches match
         ON match.id = revision.match_id
        AND match.tournament_id = revision.tournament_id
        AND match.active_revision_id = revision.id
       JOIN active_tournament_snapshots active
         ON active.tournament_id = run.legacy_tournament_id
        AND active.snapshot_version = run.source_snapshot_version
       JOIN tournament_snapshot_versions snapshot
         ON snapshot.tournament_id = active.tournament_id
        AND snapshot.version = active.snapshot_version
       JOIN engine_match_revision_teams winner
         ON winner.revision_id = revision.id
        AND winner.team_id = NEW.winner_team_id
        AND winner.result = 'win'
       WHERE run.id = NEW.legacy_backfill_run_id
         AND run.status IN ('running', 'completed')
         AND run.tool_version >= 2
         AND tournament.year = 2026
         AND tournament.lifecycle = 'completed'
         AND snapshot.status = 'completed'
         AND revision.source_adapter = 'legacy_backfill'
         AND revision.metadata ->> 'legacyBackfillRunId' = run.id::text
         AND revision.metadata ->> 'sourceSnapshotVersion' =
           run.source_snapshot_version::text
         AND revision.status = NEW.match_status
     ) THEN
    RAISE EXCEPTION 'Legacy bracket resolution provenance is invalid.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION engine_validate_legacy_pod_finalization_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.provenance_kind <> 'legacy_backfill' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM engine_legacy_backfill_runs run
    JOIN engine_tournaments tournament
      ON tournament.id = NEW.tournament_id
     AND tournament.public_key = run.legacy_tournament_id
    JOIN active_tournament_snapshots active
      ON active.tournament_id = run.legacy_tournament_id
     AND active.snapshot_version = run.source_snapshot_version
    JOIN tournament_snapshot_versions snapshot
      ON snapshot.tournament_id = active.tournament_id
     AND snapshot.version = active.snapshot_version
    JOIN engine_pod_finalizations finalization
      ON finalization.id = NEW.finalization_id
     AND finalization.tournament_id = NEW.tournament_id
     AND finalization.pod_id = NEW.pod_id
     AND finalization.calculation_id = NEW.calculation_id
    WHERE run.id = NEW.legacy_backfill_run_id
      AND run.status IN ('running', 'completed')
      AND run.tool_version >= 2
      AND tournament.year = 2026
      AND tournament.lifecycle = 'completed'
      AND tournament.visibility = 'public'
      AND snapshot.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'Legacy pod finalization provenance is invalid.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION engine_validate_legacy_bracket_advancement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.provenance_kind <> 'legacy_backfill' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM engine_legacy_backfill_runs run
    JOIN engine_tournaments tournament
      ON tournament.id = NEW.tournament_id
     AND tournament.public_key = run.legacy_tournament_id
    JOIN active_tournament_snapshots active
      ON active.tournament_id = run.legacy_tournament_id
     AND active.snapshot_version = run.source_snapshot_version
    JOIN tournament_snapshot_versions snapshot
      ON snapshot.tournament_id = active.tournament_id
     AND snapshot.version = active.snapshot_version
    JOIN engine_bracket_match_resolutions resolution
      ON resolution.id = NEW.source_resolution_id
     AND resolution.tournament_id = NEW.tournament_id
     AND resolution.bracket_match_id = NEW.source_bracket_match_id
     AND resolution.winner_team_id = NEW.winner_team_id
     AND resolution.provenance_kind = 'legacy_backfill'
     AND resolution.legacy_backfill_run_id = run.id
    JOIN engine_active_bracket_match_resolutions selected
      ON selected.tournament_id = NEW.tournament_id
     AND selected.bracket_match_id = NEW.source_bracket_match_id
     AND selected.resolution_id = NEW.source_resolution_id
    JOIN engine_bracket_slots destination
      ON destination.tournament_id = NEW.tournament_id
     AND destination.bracket_match_id = NEW.destination_bracket_match_id
     AND destination.slot_number = NEW.destination_slot_number
     AND destination.source_type = 'match_winner'
     AND destination.source_bracket_match_id = NEW.source_bracket_match_id
     AND destination.team_id = NEW.winner_team_id
    WHERE run.id = NEW.legacy_backfill_run_id
      AND run.status IN ('running', 'completed')
      AND run.tool_version >= 2
      AND tournament.year = 2026
      AND tournament.lifecycle = 'completed'
      AND tournament.visibility = 'public'
      AND snapshot.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'Legacy bracket advancement provenance is invalid.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_bracket_resolutions_legacy_provenance_guard
  BEFORE INSERT ON engine_bracket_match_resolutions
  FOR EACH ROW EXECUTE FUNCTION engine_validate_legacy_bracket_resolution();

CREATE TRIGGER engine_pod_finalization_legacy_provenance_guard
  BEFORE INSERT ON engine_pod_finalization_provenance
  FOR EACH ROW
  EXECUTE FUNCTION engine_validate_legacy_pod_finalization_provenance();

CREATE TRIGGER engine_bracket_advancements_legacy_provenance_guard
  BEFORE INSERT ON engine_bracket_advancements
  FOR EACH ROW EXECUTE FUNCTION engine_validate_legacy_bracket_advancement();

CREATE CONSTRAINT TRIGGER engine_bracket_publications_legacy_release_guard
  AFTER INSERT ON engine_bracket_publications
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION engine_validate_legacy_bracket_release_at_commit();

CREATE CONSTRAINT TRIGGER engine_bracket_resolutions_legacy_release_guard
  AFTER INSERT ON engine_bracket_match_resolutions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION engine_validate_legacy_bracket_release_at_commit();

CREATE CONSTRAINT TRIGGER engine_pod_finalization_legacy_release_guard
  AFTER INSERT ON engine_pod_finalization_provenance
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION engine_validate_legacy_bracket_release_at_commit();

CREATE CONSTRAINT TRIGGER engine_bracket_advancements_legacy_release_guard
  AFTER INSERT ON engine_bracket_advancements
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION engine_validate_legacy_bracket_release_at_commit();
