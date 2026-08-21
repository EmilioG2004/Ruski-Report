CREATE TABLE engine_standing_calculation_matches (
  tournament_id uuid NOT NULL,
  calculation_id uuid NOT NULL,
  match_id uuid NOT NULL,
  revision_id uuid,
  statistic_run_id uuid,
  statistic_input_digest text,
  status text NOT NULL,
  score_availability text NOT NULL,
  disposition text NOT NULL,
  blocking_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (calculation_id, match_id),
  FOREIGN KEY (tournament_id, calculation_id)
    REFERENCES engine_standing_calculations(tournament_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, match_id)
    REFERENCES engine_matches(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, match_id, revision_id)
    REFERENCES engine_match_revisions(tournament_id, match_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, statistic_run_id)
    REFERENCES engine_statistic_runs(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_standing_match_digest_valid CHECK (
    statistic_input_digest IS NULL
    OR statistic_input_digest ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT engine_standing_match_status_valid CHECK (
    status IN (
      'scheduled', 'in_progress', 'final', 'forfeited', 'cancelled', 'postponed'
    )
  ),
  CONSTRAINT engine_standing_match_score_availability_valid CHECK (
    score_availability IN (
      'not_started', 'partial', 'complete', 'unrecorded', 'not_applicable'
    )
  ),
  CONSTRAINT engine_standing_match_disposition_valid CHECK (
    disposition IN (
      'included_final', 'included_forfeit', 'excluded_cancelled', 'blocking'
    )
  ),
  CONSTRAINT engine_standing_match_blocking_consistent CHECK (
    (disposition = 'blocking' AND blocking_reason IS NOT NULL)
    OR (disposition <> 'blocking' AND blocking_reason IS NULL)
  ),
  CONSTRAINT engine_standing_match_blocking_reason_valid CHECK (
    blocking_reason IS NULL
    OR blocking_reason IN (
      'scheduled', 'postponed', 'in_progress', 'final_unrecorded'
    )
  )
);

CREATE TABLE engine_active_pod_standing_calculations (
  tournament_id uuid NOT NULL,
  pod_id uuid NOT NULL,
  calculation_id uuid NOT NULL,
  activated_at timestamptz NOT NULL,
  PRIMARY KEY (tournament_id, pod_id),
  FOREIGN KEY (tournament_id, pod_id, calculation_id)
    REFERENCES engine_standing_calculations(tournament_id, pod_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE engine_active_tournament_standing_calculations (
  tournament_id uuid PRIMARY KEY
    REFERENCES engine_tournaments(id) ON DELETE RESTRICT,
  calculation_id uuid NOT NULL,
  activated_at timestamptz NOT NULL,
  FOREIGN KEY (tournament_id, calculation_id)
    REFERENCES engine_standing_calculations(tournament_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE engine_standing_resolution_commands (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  pod_id uuid NOT NULL,
  source_calculation_id uuid NOT NULL,
  resolved_calculation_id uuid NOT NULL,
  confirmation_digest text NOT NULL,
  reason text NOT NULL,
  resolved_by_admin_id uuid NOT NULL
    REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  resolved_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, pod_id, source_calculation_id)
    REFERENCES engine_standing_calculations(tournament_id, pod_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, pod_id, resolved_calculation_id)
    REFERENCES engine_standing_calculations(tournament_id, pod_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT engine_standing_resolution_calculations_distinct
    CHECK (source_calculation_id <> resolved_calculation_id),
  CONSTRAINT engine_standing_resolution_digest_valid
    CHECK (confirmation_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_standing_resolution_reason_nonempty
    CHECK (length(btrim(reason)) > 0),
  UNIQUE (tournament_id, pod_id, resolved_calculation_id),
  UNIQUE (tournament_id, id)
);

CREATE TABLE engine_standing_resolution_rows (
  resolution_id uuid NOT NULL,
  tournament_id uuid NOT NULL,
  team_id uuid NOT NULL,
  tie_group text NOT NULL,
  resolved_rank integer NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (resolution_id, team_id),
  FOREIGN KEY (tournament_id, resolution_id)
    REFERENCES engine_standing_resolution_commands(tournament_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, team_id)
    REFERENCES engine_teams(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_standing_resolution_tie_group_nonempty
    CHECK (length(btrim(tie_group)) > 0),
  CONSTRAINT engine_standing_resolution_rank_positive
    CHECK (resolved_rank > 0),
  UNIQUE (resolution_id, resolved_rank)
);

CREATE TABLE engine_pod_finalization_provenance (
  finalization_id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  pod_id uuid NOT NULL,
  calculation_id uuid NOT NULL,
  override_digest text NOT NULL,
  confirmation_digest text NOT NULL,
  finalized_by_admin_id uuid NOT NULL
    REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, pod_id, finalization_id)
    REFERENCES engine_pod_finalizations(tournament_id, pod_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, pod_id, calculation_id)
    REFERENCES engine_standing_calculations(tournament_id, pod_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT engine_pod_finalization_confirmation_digest_valid
    CHECK (confirmation_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_pod_finalization_override_digest_valid
    CHECK (override_digest ~ '^[a-f0-9]{64}$'),
  UNIQUE (tournament_id, pod_id, finalization_id)
);

CREATE TABLE engine_pod_finalization_invalidations (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  pod_id uuid NOT NULL,
  finalization_id uuid NOT NULL,
  replacement_calculation_id uuid NOT NULL,
  correction_match_id uuid NOT NULL,
  correction_revision_id uuid NOT NULL,
  confirmation_digest text NOT NULL,
  reason text NOT NULL,
  invalidated_by_admin_id uuid NOT NULL
    REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  invalidated_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, pod_id, finalization_id)
    REFERENCES engine_pod_finalizations(tournament_id, pod_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, pod_id, replacement_calculation_id)
    REFERENCES engine_standing_calculations(tournament_id, pod_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, correction_match_id, correction_revision_id)
    REFERENCES engine_match_revisions(tournament_id, match_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT engine_pod_invalidation_digest_valid
    CHECK (confirmation_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_pod_invalidation_reason_nonempty
    CHECK (length(btrim(reason)) > 0),
  UNIQUE (tournament_id, pod_id, finalization_id),
  UNIQUE (tournament_id, correction_revision_id)
);

CREATE TABLE engine_seed_calculation_finalizations (
  tournament_id uuid NOT NULL,
  calculation_id uuid NOT NULL,
  pod_id uuid NOT NULL,
  finalization_id uuid NOT NULL,
  PRIMARY KEY (calculation_id, pod_id),
  FOREIGN KEY (tournament_id, calculation_id)
    REFERENCES engine_seed_calculations(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, pod_id, finalization_id)
    REFERENCES engine_pod_finalizations(tournament_id, pod_id, id)
    ON DELETE RESTRICT,
  UNIQUE (calculation_id, finalization_id)
);

CREATE TABLE engine_global_seed_review_versions (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL
    REFERENCES engine_tournaments(id) ON DELETE RESTRICT,
  seed_calculation_id uuid NOT NULL,
  rules_version integer NOT NULL,
  input_digest text NOT NULL,
  status text NOT NULL,
  calculation_input jsonb NOT NULL,
  tie_groups jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT engine_global_seed_review_rules_positive
    CHECK (rules_version > 0),
  CONSTRAINT engine_global_seed_review_digest_valid
    CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_global_seed_review_status_valid
    CHECK (status IN ('unresolved_tie', 'complete')),
  CONSTRAINT engine_global_seed_review_ties_array
    CHECK (jsonb_typeof(tie_groups) = 'array'),
  UNIQUE (tournament_id, id),
  UNIQUE (tournament_id, seed_calculation_id, id)
);

CREATE TABLE engine_global_seed_review_rows (
  review_version_id uuid NOT NULL,
  tournament_id uuid NOT NULL,
  team_id uuid NOT NULL,
  pod_id uuid NOT NULL,
  pod_rank integer NOT NULL,
  wins integer NOT NULL,
  losses integer NOT NULL,
  cup_differential integer NOT NULL,
  makes integer NOT NULL,
  attempts integer NOT NULL,
  shooting_percentage numeric,
  calculated_seed integer,
  tie_group text,
  administrator_resolution jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (review_version_id, team_id),
  FOREIGN KEY (tournament_id, review_version_id)
    REFERENCES engine_global_seed_review_versions(tournament_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, team_id)
    REFERENCES engine_teams(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, pod_id)
    REFERENCES engine_pods(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_global_seed_review_rank_positive
    CHECK (pod_rank > 0),
  CONSTRAINT engine_global_seed_review_counts_nonnegative
    CHECK (
      wins >= 0 AND losses >= 0 AND makes >= 0 AND attempts >= 0
      AND makes <= attempts
    ),
  CONSTRAINT engine_global_seed_review_percentage_valid CHECK (
    shooting_percentage IS NULL
    OR shooting_percentage BETWEEN 0 AND 1
  ),
  CONSTRAINT engine_global_seed_review_seed_positive
    CHECK (calculated_seed IS NULL OR calculated_seed > 0),
  UNIQUE (review_version_id, calculated_seed)
);

CREATE TABLE engine_active_global_seed_reviews (
  tournament_id uuid PRIMARY KEY
    REFERENCES engine_tournaments(id) ON DELETE RESTRICT,
  review_version_id uuid NOT NULL,
  seed_calculation_id uuid NOT NULL,
  activated_at timestamptz NOT NULL,
  FOREIGN KEY (
    tournament_id, seed_calculation_id, review_version_id
  ) REFERENCES engine_global_seed_review_versions(
    tournament_id, seed_calculation_id, id
  ) ON DELETE RESTRICT
);

CREATE TABLE engine_global_seed_resolution_commands (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  seed_calculation_id uuid NOT NULL,
  source_review_version_id uuid NOT NULL,
  resolved_review_version_id uuid NOT NULL,
  tie_group text NOT NULL,
  confirmation_digest text NOT NULL,
  reason text NOT NULL,
  resolved_by_admin_id uuid NOT NULL
    REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  resolved_at timestamptz NOT NULL,
  ordered_team_ids uuid[] NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (
    tournament_id, seed_calculation_id, source_review_version_id
  ) REFERENCES engine_global_seed_review_versions(
    tournament_id, seed_calculation_id, id
  ) ON DELETE RESTRICT,
  FOREIGN KEY (
    tournament_id, seed_calculation_id, resolved_review_version_id
  ) REFERENCES engine_global_seed_review_versions(
    tournament_id, seed_calculation_id, id
  ) ON DELETE RESTRICT,
  CONSTRAINT engine_global_seed_resolution_versions_distinct
    CHECK (source_review_version_id <> resolved_review_version_id),
  CONSTRAINT engine_global_seed_resolution_tie_group_nonempty
    CHECK (length(btrim(tie_group)) > 0),
  CONSTRAINT engine_global_seed_resolution_digest_valid
    CHECK (confirmation_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_global_seed_resolution_reason_nonempty
    CHECK (length(btrim(reason)) > 0),
  CONSTRAINT engine_global_seed_resolution_order_nonempty
    CHECK (cardinality(ordered_team_ids) > 1),
  UNIQUE (tournament_id, resolved_review_version_id),
  UNIQUE (tournament_id, id)
);

CREATE TABLE engine_active_seed_calculations (
  tournament_id uuid PRIMARY KEY
    REFERENCES engine_tournaments(id) ON DELETE RESTRICT,
  calculation_id uuid NOT NULL,
  activated_at timestamptz NOT NULL,
  FOREIGN KEY (tournament_id, calculation_id)
    REFERENCES engine_seed_calculations(tournament_id, id) ON DELETE RESTRICT
);

CREATE TABLE engine_seed_override_commands (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  calculation_id uuid NOT NULL,
  override_digest text NOT NULL,
  confirmation_digest text NOT NULL,
  reason text NOT NULL,
  overridden_by_admin_id uuid NOT NULL
    REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  overridden_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, calculation_id)
    REFERENCES engine_seed_calculations(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_seed_override_command_digest_valid
    CHECK (
      confirmation_digest ~ '^[a-f0-9]{64}$'
      AND override_digest ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT engine_seed_override_command_reason_nonempty
    CHECK (length(btrim(reason)) > 0),
  UNIQUE (tournament_id, id)
);

CREATE TABLE engine_seed_override_command_rows (
  command_id uuid NOT NULL,
  tournament_id uuid NOT NULL,
  team_id uuid NOT NULL,
  previous_seed integer NOT NULL,
  new_seed integer NOT NULL,
  override_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (command_id, team_id),
  FOREIGN KEY (tournament_id, command_id)
    REFERENCES engine_seed_override_commands(tournament_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, team_id)
    REFERENCES engine_teams(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, team_id, override_id)
    REFERENCES engine_seed_overrides(tournament_id, team_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT engine_seed_override_command_seeds_positive
    CHECK (previous_seed > 0 AND new_seed > 0),
  CONSTRAINT engine_seed_override_row_change_consistent CHECK (
    (previous_seed = new_seed AND override_id IS NULL)
    OR (previous_seed <> new_seed AND override_id IS NOT NULL)
  ),
  UNIQUE (command_id, new_seed),
  UNIQUE (command_id, override_id)
);

CREATE TABLE engine_active_seed_override_commands (
  tournament_id uuid PRIMARY KEY
    REFERENCES engine_tournaments(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL,
  activated_at timestamptz NOT NULL,
  FOREIGN KEY (tournament_id, command_id)
    REFERENCES engine_seed_override_commands(tournament_id, id)
    ON DELETE RESTRICT
);

ALTER TABLE engine_bracket_matches
  ADD COLUMN playable boolean NOT NULL DEFAULT true;

ALTER TABLE engine_bracket_matches
  ALTER COLUMN match_id DROP NOT NULL;

ALTER TABLE engine_bracket_matches
  ADD CONSTRAINT engine_bracket_matches_playability_consistent CHECK (
    NOT playable OR match_id IS NOT NULL
  );

CREATE UNIQUE INDEX engine_bracket_slots_one_consumer_per_winner_source
  ON engine_bracket_slots (source_bracket_match_id)
  WHERE source_type = 'match_winner';

ALTER TABLE engine_generated_workbook_sheets
  ALTER CONSTRAINT engine_generated_workbook_sheets_tournament_id_match_id_fkey
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE engine_bracket_publications (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  bracket_id uuid NOT NULL,
  seed_calculation_id uuid NOT NULL,
  seed_override_command_id uuid,
  cumulative_workbook_id uuid NOT NULL,
  confirmation_digest text NOT NULL,
  published_by_admin_id uuid NOT NULL
    REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  published_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, bracket_id)
    REFERENCES engine_brackets(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, seed_calculation_id)
    REFERENCES engine_seed_calculations(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, seed_override_command_id)
    REFERENCES engine_seed_override_commands(tournament_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, cumulative_workbook_id)
    REFERENCES engine_generated_workbooks(tournament_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT engine_bracket_publication_digest_valid
    CHECK (confirmation_digest ~ '^[a-f0-9]{64}$'),
  UNIQUE (tournament_id, bracket_id),
  UNIQUE (tournament_id, id)
);

CREATE TABLE engine_active_brackets (
  tournament_id uuid PRIMARY KEY
    REFERENCES engine_tournaments(id) ON DELETE RESTRICT,
  bracket_id uuid NOT NULL,
  publication_id uuid NOT NULL,
  activated_at timestamptz NOT NULL,
  FOREIGN KEY (tournament_id, bracket_id)
    REFERENCES engine_brackets(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, publication_id)
    REFERENCES engine_bracket_publications(tournament_id, id)
    ON DELETE RESTRICT,
  UNIQUE (bracket_id),
  UNIQUE (publication_id)
);

CREATE TABLE engine_bracket_match_resolutions (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  bracket_match_id uuid NOT NULL,
  match_id uuid,
  revision_id uuid,
  winner_team_id uuid NOT NULL,
  resolution_type text NOT NULL,
  match_status text NOT NULL,
  confirmation_digest text NOT NULL,
  resolved_by_admin_id uuid NOT NULL
    REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  resolved_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, bracket_match_id)
    REFERENCES engine_bracket_matches(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, match_id, revision_id)
    REFERENCES engine_match_revisions(tournament_id, match_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, winner_team_id)
    REFERENCES engine_teams(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_bracket_resolution_type_valid
    CHECK (resolution_type IN ('match_result', 'structural_bye')),
  CONSTRAINT engine_bracket_resolution_status_valid
    CHECK (match_status IN ('final', 'forfeited', 'bye')),
  CONSTRAINT engine_bracket_resolution_source_consistent CHECK (
    (
      resolution_type = 'match_result'
      AND match_id IS NOT NULL
      AND revision_id IS NOT NULL
      AND match_status IN ('final', 'forfeited')
    ) OR (
      resolution_type = 'structural_bye'
      AND match_id IS NULL
      AND revision_id IS NULL
      AND match_status = 'bye'
    )
  ),
  CONSTRAINT engine_bracket_resolution_digest_valid
    CHECK (confirmation_digest ~ '^[a-f0-9]{64}$'),
  UNIQUE (tournament_id, id),
  UNIQUE (tournament_id, bracket_match_id, id)
);

CREATE TABLE engine_active_bracket_match_resolutions (
  tournament_id uuid NOT NULL,
  bracket_match_id uuid NOT NULL,
  resolution_id uuid NOT NULL,
  activated_at timestamptz NOT NULL,
  PRIMARY KEY (tournament_id, bracket_match_id),
  FOREIGN KEY (tournament_id, bracket_match_id)
    REFERENCES engine_bracket_matches(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, bracket_match_id, resolution_id)
    REFERENCES engine_bracket_match_resolutions(
      tournament_id, bracket_match_id, id
    )
    ON DELETE RESTRICT,
  UNIQUE (resolution_id)
);

CREATE TABLE engine_bracket_advancements (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  source_bracket_match_id uuid NOT NULL,
  source_resolution_id uuid NOT NULL,
  destination_bracket_match_id uuid NOT NULL,
  destination_slot_number smallint NOT NULL,
  winner_team_id uuid NOT NULL,
  previous_team_id uuid,
  confirmation_digest text NOT NULL,
  advanced_by_admin_id uuid NOT NULL
    REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  advanced_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, source_bracket_match_id)
    REFERENCES engine_bracket_matches(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (
    tournament_id, source_bracket_match_id, source_resolution_id
  ) REFERENCES engine_bracket_match_resolutions(
    tournament_id, bracket_match_id, id
  )
    ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, destination_bracket_match_id)
    REFERENCES engine_bracket_matches(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, winner_team_id)
    REFERENCES engine_teams(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, previous_team_id)
    REFERENCES engine_teams(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_bracket_advancement_slot_valid
    CHECK (destination_slot_number IN (1, 2)),
  CONSTRAINT engine_bracket_advancement_not_self CHECK (
    source_bracket_match_id <> destination_bracket_match_id
  ),
  CONSTRAINT engine_bracket_advancement_digest_valid
    CHECK (confirmation_digest ~ '^[a-f0-9]{64}$'),
  UNIQUE (tournament_id, id),
  UNIQUE (source_resolution_id, destination_bracket_match_id)
);

CREATE TABLE engine_bracket_resolution_invalidations (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  bracket_match_id uuid NOT NULL,
  resolution_id uuid NOT NULL,
  correction_revision_id uuid NOT NULL,
  destination_bracket_match_id uuid,
  affected_match_id uuid,
  confirmation_digest text NOT NULL,
  reason text NOT NULL,
  invalidated_by_admin_id uuid NOT NULL
    REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  invalidated_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, bracket_match_id, resolution_id)
    REFERENCES engine_bracket_match_resolutions(
      tournament_id, bracket_match_id, id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, correction_revision_id)
    REFERENCES engine_match_revisions(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, destination_bracket_match_id)
    REFERENCES engine_bracket_matches(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, affected_match_id)
    REFERENCES engine_matches(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_bracket_resolution_invalidation_match_consistent
    CHECK (
      (destination_bracket_match_id IS NULL AND affected_match_id IS NULL)
      OR destination_bracket_match_id IS NOT NULL
    ),
  CONSTRAINT engine_bracket_resolution_invalidation_digest_valid
    CHECK (confirmation_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_bracket_resolution_invalidation_reason_nonempty
    CHECK (length(btrim(reason)) > 0),
  UNIQUE (tournament_id, resolution_id),
  UNIQUE (tournament_id, id)
);

CREATE TABLE engine_bracket_match_replacements (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  bracket_match_id uuid NOT NULL,
  previous_match_id uuid NOT NULL,
  replacement_match_id uuid NOT NULL,
  replacement_sequence integer NOT NULL,
  create_when_playable boolean NOT NULL DEFAULT false,
  source_resolution_id uuid NOT NULL,
  confirmation_digest text NOT NULL,
  reason text NOT NULL,
  replaced_by_admin_id uuid NOT NULL
    REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  replaced_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, bracket_match_id)
    REFERENCES engine_bracket_matches(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, previous_match_id)
    REFERENCES engine_matches(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, replacement_match_id)
    REFERENCES engine_matches(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, source_resolution_id)
    REFERENCES engine_bracket_match_resolutions(tournament_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT engine_bracket_replacement_matches_distinct
    CHECK (previous_match_id <> replacement_match_id),
  CONSTRAINT engine_bracket_replacement_sequence_positive
    CHECK (replacement_sequence > 0),
  CONSTRAINT engine_bracket_replacement_digest_valid
    CHECK (confirmation_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_bracket_replacement_reason_nonempty
    CHECK (length(btrim(reason)) > 0),
  UNIQUE (tournament_id, id),
  UNIQUE (previous_match_id),
  UNIQUE (replacement_match_id)
);

CREATE TABLE engine_operator_match_commands (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  match_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  status text NOT NULL,
  confirmation_digest text NOT NULL,
  cascade_confirmation_digest text,
  administrator_id uuid NOT NULL
    REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, match_id, revision_id)
    REFERENCES engine_match_revisions(tournament_id, match_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT engine_operator_match_command_status_valid
    CHECK (status IN ('final', 'forfeited', 'cancelled', 'postponed')),
  CONSTRAINT engine_operator_match_command_digest_valid
    CHECK (
      confirmation_digest ~ '^[a-f0-9]{64}$'
      AND (
        cascade_confirmation_digest IS NULL
        OR cascade_confirmation_digest ~ '^[a-f0-9]{64}$'
      )
    ),
  UNIQUE (tournament_id, revision_id),
  UNIQUE (tournament_id, id)
);

CREATE FUNCTION engine_reject_late_standing_child_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM engine_active_pod_standing_calculations active
    WHERE active.calculation_id = NEW.calculation_id
  ) OR EXISTS (
    SELECT 1 FROM engine_pod_finalizations finalization
    WHERE finalization.calculation_id = NEW.calculation_id
  ) THEN
    RAISE EXCEPTION 'Active or finalized standing calculations are sealed.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_standing_rows_sealed_guard
  BEFORE INSERT ON engine_standing_rows
  FOR EACH ROW EXECUTE FUNCTION engine_reject_late_standing_child_insert();
CREATE TRIGGER engine_standing_calculation_matches_sealed_guard
  BEFORE INSERT ON engine_standing_calculation_matches
  FOR EACH ROW EXECUTE FUNCTION engine_reject_late_standing_child_insert();

CREATE FUNCTION engine_reject_late_standing_resolution_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM engine_standing_resolution_commands resolution
    JOIN engine_active_pod_standing_calculations active
      ON active.calculation_id = resolution.resolved_calculation_id
    WHERE resolution.id = NEW.resolution_id
  ) THEN
    RAISE EXCEPTION 'Active standing resolutions are sealed.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_standing_resolution_rows_sealed_guard
  BEFORE INSERT ON engine_standing_resolution_rows
  FOR EACH ROW EXECUTE FUNCTION engine_reject_late_standing_resolution_row();

CREATE FUNCTION engine_reject_late_global_review_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM engine_active_global_seed_reviews active
    WHERE active.review_version_id = NEW.review_version_id
  ) THEN
    RAISE EXCEPTION 'Active global seed reviews are sealed.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_global_seed_review_rows_sealed_guard
  BEFORE INSERT ON engine_global_seed_review_rows
  FOR EACH ROW EXECUTE FUNCTION engine_reject_late_global_review_row();

CREATE FUNCTION engine_reject_late_seed_child_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM engine_active_seed_calculations active
    WHERE active.calculation_id = NEW.calculation_id
  ) THEN
    RAISE EXCEPTION 'Active seed calculations are sealed.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_seed_rows_sealed_guard
  BEFORE INSERT ON engine_seed_rows
  FOR EACH ROW EXECUTE FUNCTION engine_reject_late_seed_child_insert();
CREATE TRIGGER engine_seed_calculation_finalizations_sealed_guard
  BEFORE INSERT ON engine_seed_calculation_finalizations
  FOR EACH ROW EXECUTE FUNCTION engine_reject_late_seed_child_insert();

CREATE FUNCTION engine_reject_late_seed_override_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM engine_active_seed_override_commands active
    WHERE active.command_id = NEW.command_id
  ) THEN
    RAISE EXCEPTION 'Active seed overrides are sealed.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_seed_override_command_rows_sealed_guard
  BEFORE INSERT ON engine_seed_override_command_rows
  FOR EACH ROW EXECUTE FUNCTION engine_reject_late_seed_override_row();

CREATE FUNCTION engine_reject_progression_artifact_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Tournament progression history is immutable.'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER engine_standing_calculation_matches_immutable
  BEFORE UPDATE OR DELETE ON engine_standing_calculation_matches
  FOR EACH ROW EXECUTE FUNCTION engine_reject_progression_artifact_mutation();
CREATE TRIGGER engine_standing_resolution_commands_immutable
  BEFORE UPDATE OR DELETE ON engine_standing_resolution_commands
  FOR EACH ROW EXECUTE FUNCTION engine_reject_progression_artifact_mutation();
CREATE TRIGGER engine_standing_resolution_rows_immutable
  BEFORE UPDATE OR DELETE ON engine_standing_resolution_rows
  FOR EACH ROW EXECUTE FUNCTION engine_reject_progression_artifact_mutation();
CREATE TRIGGER engine_pod_finalization_provenance_immutable
  BEFORE UPDATE OR DELETE ON engine_pod_finalization_provenance
  FOR EACH ROW EXECUTE FUNCTION engine_reject_progression_artifact_mutation();
CREATE TRIGGER engine_pod_finalization_invalidations_immutable
  BEFORE UPDATE OR DELETE ON engine_pod_finalization_invalidations
  FOR EACH ROW EXECUTE FUNCTION engine_reject_progression_artifact_mutation();
CREATE TRIGGER engine_seed_calculation_finalizations_immutable
  BEFORE UPDATE OR DELETE ON engine_seed_calculation_finalizations
  FOR EACH ROW EXECUTE FUNCTION engine_reject_progression_artifact_mutation();
CREATE TRIGGER engine_global_seed_review_versions_immutable
  BEFORE UPDATE OR DELETE ON engine_global_seed_review_versions
  FOR EACH ROW EXECUTE FUNCTION engine_reject_progression_artifact_mutation();
CREATE TRIGGER engine_global_seed_review_rows_immutable
  BEFORE UPDATE OR DELETE ON engine_global_seed_review_rows
  FOR EACH ROW EXECUTE FUNCTION engine_reject_progression_artifact_mutation();
CREATE TRIGGER engine_global_seed_resolution_commands_immutable
  BEFORE UPDATE OR DELETE ON engine_global_seed_resolution_commands
  FOR EACH ROW EXECUTE FUNCTION engine_reject_progression_artifact_mutation();
CREATE TRIGGER engine_seed_override_commands_immutable
  BEFORE UPDATE OR DELETE ON engine_seed_override_commands
  FOR EACH ROW EXECUTE FUNCTION engine_reject_progression_artifact_mutation();
CREATE TRIGGER engine_seed_override_command_rows_immutable
  BEFORE UPDATE OR DELETE ON engine_seed_override_command_rows
  FOR EACH ROW EXECUTE FUNCTION engine_reject_progression_artifact_mutation();
CREATE TRIGGER engine_bracket_publications_immutable
  BEFORE UPDATE OR DELETE ON engine_bracket_publications
  FOR EACH ROW EXECUTE FUNCTION engine_reject_progression_artifact_mutation();
CREATE TRIGGER engine_bracket_match_resolutions_immutable
  BEFORE UPDATE OR DELETE ON engine_bracket_match_resolutions
  FOR EACH ROW EXECUTE FUNCTION engine_reject_progression_artifact_mutation();
CREATE TRIGGER engine_bracket_advancements_immutable
  BEFORE UPDATE OR DELETE ON engine_bracket_advancements
  FOR EACH ROW EXECUTE FUNCTION engine_reject_progression_artifact_mutation();
CREATE TRIGGER engine_bracket_resolution_invalidations_immutable
  BEFORE UPDATE OR DELETE ON engine_bracket_resolution_invalidations
  FOR EACH ROW EXECUTE FUNCTION engine_reject_progression_artifact_mutation();
CREATE TRIGGER engine_bracket_match_replacements_immutable
  BEFORE UPDATE OR DELETE ON engine_bracket_match_replacements
  FOR EACH ROW EXECUTE FUNCTION engine_reject_progression_artifact_mutation();
CREATE TRIGGER engine_operator_match_commands_immutable
  BEFORE UPDATE OR DELETE ON engine_operator_match_commands
  FOR EACH ROW EXECUTE FUNCTION engine_reject_progression_artifact_mutation();

CREATE FUNCTION engine_guard_tournament_lifecycle_progression()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  legacy_backfill boolean;
BEGIN
  IF NEW.lifecycle IS NOT DISTINCT FROM OLD.lifecycle THEN
    RETURN NEW;
  END IF;
  legacy_backfill := COALESCE(OLD.metadata ->> 'legacyBackfill', '') = 'true'
    OR COALESCE(OLD.metadata ->> 'backfilled', '') = 'true'
    OR COALESCE(NEW.metadata ->> 'legacyBackfill', '') = 'true'
    OR COALESCE(NEW.metadata ->> 'backfilled', '') = 'true';
  IF (OLD.lifecycle = 'draft_setup' AND NEW.lifecycle = 'setup_published')
    OR (OLD.lifecycle = 'setup_published' AND NEW.lifecycle = 'pod_play')
    OR (OLD.lifecycle = 'pod_play' AND NEW.lifecycle = 'seeding_review')
    OR (OLD.lifecycle = 'seeding_review' AND NEW.lifecycle = 'playoffs')
    OR (OLD.lifecycle = 'playoffs' AND NEW.lifecycle = 'completed')
    OR (
      OLD.lifecycle = 'completed'
      AND NEW.lifecycle = 'playoffs'
      AND EXISTS (
        SELECT 1
        FROM engine_active_brackets active
        JOIN engine_brackets bracket ON bracket.id = active.bracket_id
        WHERE active.tournament_id = OLD.id
          AND bracket.status = 'published'
      )
    )
    OR (OLD.lifecycle = 'completed' AND NEW.lifecycle = 'archived')
    OR (
      OLD.lifecycle = 'draft_setup'
      AND NEW.lifecycle = 'completed'
      AND legacy_backfill
    ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Tournament lifecycle cannot move backward or skip a gate.'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER engine_tournaments_lifecycle_progression_guard
  BEFORE UPDATE OF lifecycle ON engine_tournaments
  FOR EACH ROW EXECUTE FUNCTION engine_guard_tournament_lifecycle_progression();

CREATE FUNCTION engine_guard_published_bracket_topology()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_bracket_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'engine_bracket_slots' THEN
    SELECT bracket_match.bracket_id
    INTO affected_bracket_id
    FROM engine_bracket_matches bracket_match
    WHERE bracket_match.id = CASE
      WHEN TG_OP = 'DELETE' THEN OLD.bracket_match_id
      ELSE NEW.bracket_match_id
    END;
  ELSE
    affected_bracket_id := CASE
      WHEN TG_OP = 'DELETE' THEN OLD.bracket_id
      ELSE NEW.bracket_id
    END;
  END IF;
  IF EXISTS (
    SELECT 1 FROM engine_bracket_publications publication
    WHERE publication.bracket_id = affected_bracket_id
  ) THEN
    IF TG_TABLE_NAME = 'engine_bracket_slots'
       AND TG_OP = 'UPDATE'
       AND NEW.id = OLD.id
       AND NEW.tournament_id = OLD.tournament_id
       AND NEW.bracket_match_id = OLD.bracket_match_id
       AND NEW.public_key = OLD.public_key
       AND NEW.slot_number = OLD.slot_number
       AND NEW.source_type = OLD.source_type
       AND NEW.source_bracket_match_id IS NOT DISTINCT FROM OLD.source_bracket_match_id
       AND NEW.seed IS NOT DISTINCT FROM OLD.seed
       AND NEW.metadata = OLD.metadata
       AND NEW.source_type = 'match_winner'
       AND (
         EXISTS (
           SELECT 1 FROM engine_bracket_advancements advancement
           WHERE advancement.tournament_id = NEW.tournament_id
             AND advancement.destination_bracket_match_id = NEW.bracket_match_id
             AND advancement.destination_slot_number = NEW.slot_number
             AND advancement.winner_team_id = NEW.team_id
         ) OR EXISTS (
           SELECT 1
           FROM engine_bracket_match_replacements replacement
           JOIN engine_match_slots match_slot
             ON match_slot.match_id = replacement.replacement_match_id
            AND match_slot.slot_number = NEW.slot_number
            AND match_slot.team_id = NEW.team_id
           WHERE replacement.tournament_id = NEW.tournament_id
             AND replacement.bracket_match_id = NEW.bracket_match_id
         ) OR (
           NEW.team_id IS NULL
           AND EXISTS (
             SELECT 1
             FROM engine_bracket_resolution_invalidations invalidation
             JOIN engine_bracket_advancements advancement
               ON advancement.tournament_id = invalidation.tournament_id
              AND advancement.source_resolution_id = invalidation.resolution_id
             WHERE invalidation.tournament_id = NEW.tournament_id
               AND advancement.destination_bracket_match_id = NEW.bracket_match_id
               AND advancement.destination_slot_number = NEW.slot_number
               AND advancement.winner_team_id = OLD.team_id
           )
         ) OR (
           NEW.team_id IS NULL
           AND EXISTS (
             SELECT 1
             FROM engine_bracket_match_replacements replacement
             WHERE replacement.tournament_id = NEW.tournament_id
               AND replacement.bracket_match_id = NEW.bracket_match_id
               AND replacement.create_when_playable
           )
         )
       ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Published bracket topology is immutable.'
      USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER engine_bracket_rounds_topology_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON engine_bracket_rounds
  FOR EACH ROW EXECUTE FUNCTION engine_guard_published_bracket_topology();
CREATE TRIGGER engine_bracket_slots_topology_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON engine_bracket_slots
  FOR EACH ROW EXECUTE FUNCTION engine_guard_published_bracket_topology();

CREATE FUNCTION engine_guard_published_bracket_match_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  affected_bracket_id uuid;
BEGIN
  affected_bracket_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.bracket_id
    ELSE NEW.bracket_id
  END;
  IF NOT EXISTS (
    SELECT 1 FROM engine_bracket_publications publication
    WHERE publication.bracket_id = affected_bracket_id
  ) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.id = OLD.id
     AND NEW.tournament_id = OLD.tournament_id
     AND NEW.bracket_id = OLD.bracket_id
     AND NEW.round_id = OLD.round_id
     AND NEW.public_key = OLD.public_key
     AND NEW.sequence = OLD.sequence
     AND NEW.playable = OLD.playable
     AND NEW.metadata = OLD.metadata
     AND EXISTS (
       SELECT 1
       FROM engine_bracket_match_replacements replacement
       WHERE replacement.tournament_id = NEW.tournament_id
         AND replacement.bracket_match_id = NEW.id
         AND replacement.previous_match_id = OLD.match_id
         AND replacement.replacement_match_id = NEW.match_id
     ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.id = OLD.id
     AND NEW.tournament_id = OLD.tournament_id
     AND NEW.bracket_id = OLD.bracket_id
     AND NEW.round_id = OLD.round_id
     AND NEW.public_key = OLD.public_key
     AND NEW.sequence = OLD.sequence
     AND OLD.match_id IS NOT NULL
     AND NEW.match_id IS NULL
     AND OLD.playable
     AND NOT NEW.playable
     AND NEW.metadata = OLD.metadata
     AND EXISTS (
       SELECT 1
       FROM engine_bracket_match_replacements replacement
       WHERE replacement.tournament_id = NEW.tournament_id
         AND replacement.bracket_match_id = NEW.id
         AND replacement.previous_match_id = OLD.match_id
         AND replacement.create_when_playable
     ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.id = OLD.id
     AND NEW.tournament_id = OLD.tournament_id
     AND NEW.bracket_id = OLD.bracket_id
     AND NEW.round_id = OLD.round_id
     AND NEW.public_key = OLD.public_key
     AND NEW.sequence = OLD.sequence
     AND NEW.match_id IS NOT DISTINCT FROM OLD.match_id
     AND OLD.playable
     AND NOT NEW.playable
     AND NEW.metadata = OLD.metadata
     AND EXISTS (
       SELECT 1
       FROM engine_bracket_resolution_invalidations invalidation
       JOIN engine_bracket_advancements advancement
         ON advancement.tournament_id = invalidation.tournament_id
        AND advancement.source_resolution_id = invalidation.resolution_id
       JOIN engine_matches match ON match.id = OLD.match_id
       WHERE invalidation.tournament_id = NEW.tournament_id
         AND advancement.destination_bracket_match_id = NEW.id
         AND invalidation.affected_match_id = OLD.match_id
         AND match.participants_frozen_at IS NULL
     ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.id = OLD.id
     AND NEW.tournament_id = OLD.tournament_id
     AND NEW.bracket_id = OLD.bracket_id
     AND NEW.round_id = OLD.round_id
     AND NEW.public_key = OLD.public_key
     AND NEW.sequence = OLD.sequence
     AND NEW.match_id IS NOT DISTINCT FROM OLD.match_id
     AND NOT OLD.playable
     AND NEW.playable
     AND NEW.metadata = OLD.metadata
     AND (
       SELECT count(*) = 2 AND count(team_id) = 2
       FROM engine_bracket_slots slot
       WHERE slot.bracket_match_id = NEW.id
     )
     AND EXISTS (
       SELECT 1 FROM engine_bracket_advancements advancement
       WHERE advancement.tournament_id = NEW.tournament_id
         AND advancement.destination_bracket_match_id = NEW.id
     ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.match_id IS NULL
     AND NOT OLD.playable
     AND NEW.match_id IS NOT NULL
     AND NEW.playable
     AND NEW.id = OLD.id
     AND NEW.tournament_id = OLD.tournament_id
     AND NEW.bracket_id = OLD.bracket_id
     AND NEW.round_id = OLD.round_id
     AND NEW.public_key = OLD.public_key
     AND NEW.sequence = OLD.sequence
     AND NEW.metadata = OLD.metadata
     AND (
       SELECT count(*) = 2 AND count(team_id) = 2
       FROM engine_bracket_slots slot
       WHERE slot.bracket_match_id = NEW.id
     )
     AND EXISTS (
       SELECT 1 FROM engine_matches match
       WHERE match.id = NEW.match_id
         AND match.tournament_id = NEW.tournament_id
         AND match.stage = 'playoffs'
         AND match.status = 'scheduled'
     ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Published bracket match topology is immutable.'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER engine_bracket_matches_topology_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON engine_bracket_matches
  FOR EACH ROW EXECUTE FUNCTION engine_guard_published_bracket_match_update();

CREATE FUNCTION engine_validate_bracket_winner_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  destination_bracket_id uuid;
  destination_round_sequence integer;
  source_bracket_id uuid;
  source_round_sequence integer;
BEGIN
  IF NEW.source_type <> 'match_winner' THEN
    RETURN NEW;
  END IF;
  SELECT destination.bracket_id, destination_round.sequence
  INTO destination_bracket_id, destination_round_sequence
  FROM engine_bracket_matches destination
  JOIN engine_bracket_rounds destination_round
    ON destination_round.id = destination.round_id
  WHERE destination.id = NEW.bracket_match_id;
  SELECT source.bracket_id, source_round.sequence
  INTO source_bracket_id, source_round_sequence
  FROM engine_bracket_matches source
  JOIN engine_bracket_rounds source_round ON source_round.id = source.round_id
  WHERE source.id = NEW.source_bracket_match_id;
  IF destination_bracket_id IS NULL
     OR source_bracket_id IS DISTINCT FROM destination_bracket_id
     OR source_round_sequence <> destination_round_sequence - 1 THEN
    RAISE EXCEPTION 'Bracket winner sources must point to the immediate prior round in the same bracket.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_bracket_slots_winner_source_guard
  BEFORE INSERT OR UPDATE OF source_type, source_bracket_match_id
  ON engine_bracket_slots
  FOR EACH ROW EXECUTE FUNCTION engine_validate_bracket_winner_source();

CREATE FUNCTION engine_validate_bracket_publication()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM engine_generated_workbooks workbook
    WHERE workbook.id = NEW.cumulative_workbook_id
      AND workbook.tournament_id = NEW.tournament_id
      AND workbook.generation_kind = 'playoffs_cumulative'
  ) OR NOT EXISTS (
    SELECT 1
    FROM engine_active_seed_calculations active_seed
    WHERE active_seed.tournament_id = NEW.tournament_id
      AND active_seed.calculation_id = NEW.seed_calculation_id
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
  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_bracket_publication_provenance_guard
  BEFORE INSERT ON engine_bracket_publications
  FOR EACH ROW EXECUTE FUNCTION engine_validate_bracket_publication();

CREATE FUNCTION engine_validate_active_bracket_publication()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM engine_bracket_publications publication
    WHERE publication.id = NEW.publication_id
      AND publication.tournament_id = NEW.tournament_id
      AND publication.bracket_id = NEW.bracket_id
  ) THEN
    RAISE EXCEPTION 'Active bracket must select its matching publication.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_active_brackets_publication_guard
  BEFORE INSERT OR UPDATE ON engine_active_brackets
  FOR EACH ROW EXECUTE FUNCTION engine_validate_active_bracket_publication();
