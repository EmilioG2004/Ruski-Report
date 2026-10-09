CREATE FUNCTION engine_workbook_validation_issues_are_safe(issues jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  issue jsonb;
BEGIN
  IF jsonb_typeof(issues) <> 'array'
     OR jsonb_array_length(issues) > 100 THEN
    RETURN false;
  END IF;
  FOR issue IN SELECT value FROM jsonb_array_elements(issues)
  LOOP
    IF jsonb_typeof(issue) <> 'object'
       OR issue - ARRAY['code', 'severity', 'message', 'path']::text[] <> '{}'::jsonb
       OR jsonb_typeof(issue -> 'code') <> 'string'
       OR jsonb_typeof(issue -> 'severity') <> 'string'
       OR jsonb_typeof(issue -> 'message') <> 'string'
       OR COALESCE(issue ->> 'code', '') !~ '^[A-Z][A-Z0-9_]{1,79}$'
       OR COALESCE(issue ->> 'severity', '') NOT IN ('warning', 'error')
       OR char_length(btrim(COALESCE(issue ->> 'message', ''))) NOT BETWEEN 1 AND 500
       OR (
         issue ? 'path'
         AND (
           jsonb_typeof(issue -> 'path') <> 'string'
           OR char_length(COALESCE(issue ->> 'path', '')) NOT BETWEEN 1 AND 240
         )
       ) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE FUNCTION engine_guard_workbook_publication_capacity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  required_game_sheet_count bigint;
BEGIN
  IF OLD.lifecycle = 'draft_setup'
     AND NEW.lifecycle <> 'draft_setup' THEN
    SELECT sum(
      (pod_size::bigint * (pod_size::bigint - 1) / 2)
      * configuration.games_per_pair::bigint
    )
    INTO required_game_sheet_count
    FROM engine_tournament_configurations configuration
    CROSS JOIN LATERAL unnest(configuration.pod_sizes) AS pod_size
    WHERE configuration.tournament_id = NEW.id;

    IF required_game_sheet_count > 257 THEN
      RAISE EXCEPTION
        'Published tournament exceeds the canonical workbook game-sheet capacity.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_tournaments_workbook_publication_capacity_guard
  BEFORE UPDATE OF lifecycle ON engine_tournaments
  FOR EACH ROW EXECUTE FUNCTION engine_guard_workbook_publication_capacity();

CREATE TABLE engine_generated_workbooks (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL
    REFERENCES engine_tournaments(id) ON DELETE RESTRICT,
  generation_revision bigint NOT NULL,
  workbook_schema_version integer NOT NULL,
  generation_kind text NOT NULL,
  source_tournament_row_version bigint NOT NULL,
  source_digest text NOT NULL,
  artifact_digest text NOT NULL,
  artifact_size_bytes bigint NOT NULL,
  artifact bytea NOT NULL,
  filename text NOT NULL,
  generated_by_admin_id uuid NOT NULL
    REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  generated_at timestamptz NOT NULL,
  CONSTRAINT engine_generated_workbooks_revision_positive
    CHECK (generation_revision > 0),
  CONSTRAINT engine_generated_workbooks_schema_positive
    CHECK (workbook_schema_version > 0),
  CONSTRAINT engine_generated_workbooks_kind_valid CHECK (
    generation_kind IN ('setup', 'playoffs_cumulative')
  ),
  CONSTRAINT engine_generated_workbooks_source_version_positive
    CHECK (source_tournament_row_version > 0),
  CONSTRAINT engine_generated_workbooks_source_digest_valid
    CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_generated_workbooks_artifact_digest_valid
    CHECK (artifact_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_generated_workbooks_artifact_size_valid CHECK (
    artifact_size_bytes = octet_length(artifact)
    AND artifact_size_bytes > 0
    AND artifact_size_bytes <= 52428800
  ),
  CONSTRAINT engine_generated_workbooks_filename_valid CHECK (
    filename ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.xlsx$'
  ),
  UNIQUE (tournament_id, id),
  UNIQUE (tournament_id, generation_revision),
  UNIQUE (tournament_id, workbook_schema_version, source_digest)
);

CREATE INDEX engine_generated_workbooks_tournament_time_idx
  ON engine_generated_workbooks (
    tournament_id, generated_at DESC, generation_revision DESC
  );

CREATE TABLE engine_generated_workbook_sheets (
  workbook_id uuid NOT NULL,
  tournament_id uuid NOT NULL,
  sheet_id uuid NOT NULL,
  sheet_ordinal smallint NOT NULL,
  sheet_kind text NOT NULL,
  sheet_name text NOT NULL,
  match_id uuid,
  generated_match_row_version bigint,
  side_one_team_id uuid,
  side_two_team_id uuid,
  participant_digest text,
  baseline_fingerprint text,
  PRIMARY KEY (workbook_id, sheet_id),
  FOREIGN KEY (tournament_id, workbook_id)
    REFERENCES engine_generated_workbooks(tournament_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, match_id)
    REFERENCES engine_matches(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, side_one_team_id)
    REFERENCES engine_teams(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, side_two_team_id)
    REFERENCES engine_teams(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_generated_workbook_sheets_ordinal_positive
    CHECK (sheet_ordinal > 0),
  CONSTRAINT engine_generated_workbook_sheets_kind_valid
    CHECK (sheet_kind IN ('control', 'blank', 'game')),
  CONSTRAINT engine_generated_workbook_sheets_name_valid CHECK (
    char_length(sheet_name) BETWEEN 1 AND 31
    AND sheet_name !~ '[\\/\?\*\[\]:]'
  ),
  CONSTRAINT engine_generated_workbook_sheets_baseline_valid
    CHECK (
      baseline_fingerprint IS NULL
      OR baseline_fingerprint ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT engine_generated_workbook_sheets_participant_digest_valid
    CHECK (
      participant_digest IS NULL
      OR participant_digest ~ '^[a-f0-9]{64}$'
    ),
  CONSTRAINT engine_generated_workbook_sheets_game_consistent CHECK (
    (
      sheet_kind = 'game'
      AND match_id IS NOT NULL
      AND generated_match_row_version > 0
      AND side_one_team_id IS NOT NULL
      AND side_two_team_id IS NOT NULL
      AND side_one_team_id <> side_two_team_id
      AND participant_digest IS NOT NULL
      AND baseline_fingerprint IS NOT NULL
    )
    OR (
      sheet_kind = 'blank'
      AND match_id IS NULL
      AND generated_match_row_version IS NULL
      AND side_one_team_id IS NULL
      AND side_two_team_id IS NULL
      AND participant_digest IS NULL
      AND baseline_fingerprint IS NOT NULL
    )
    OR (
      sheet_kind = 'control'
      AND match_id IS NULL
      AND generated_match_row_version IS NULL
      AND side_one_team_id IS NULL
      AND side_two_team_id IS NULL
      AND participant_digest IS NULL
    )
  ),
  UNIQUE (workbook_id, sheet_ordinal),
  UNIQUE (workbook_id, sheet_name),
  UNIQUE (tournament_id, workbook_id, sheet_id),
  UNIQUE (tournament_id, workbook_id, match_id)
);

CREATE TABLE engine_workbook_import_batches (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL
    REFERENCES engine_tournaments(id) ON DELETE RESTRICT,
  workbook_id uuid NOT NULL,
  workbook_schema_version integer NOT NULL,
  source_workbook_digest text NOT NULL,
  source_size_bytes bigint NOT NULL,
  base_tournament_row_version bigint NOT NULL,
  preview_digest text NOT NULL,
  status text NOT NULL,
  supersedes_batch_id uuid,
  recognized_sheet_count integer NOT NULL,
  proposed_sheet_count integer NOT NULL,
  unchanged_sheet_count integer NOT NULL,
  missing_sheet_count integer NOT NULL,
  invalid_sheet_count integer NOT NULL,
  received_by_admin_id uuid NOT NULL
    REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  received_at timestamptz NOT NULL,
  previewed_at timestamptz NOT NULL,
  preview_expires_at timestamptz NOT NULL,
  confirmed_by_admin_id uuid REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  confirmed_at timestamptz,
  completed_at timestamptz,
  FOREIGN KEY (tournament_id, workbook_id)
    REFERENCES engine_generated_workbooks(tournament_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT engine_workbook_import_batches_schema_positive
    CHECK (workbook_schema_version > 0),
  CONSTRAINT engine_workbook_import_batches_source_digest_valid
    CHECK (source_workbook_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_workbook_import_batches_size_valid CHECK (
    source_size_bytes > 0 AND source_size_bytes <= 52428800
  ),
  CONSTRAINT engine_workbook_import_batches_base_version_positive
    CHECK (base_tournament_row_version > 0),
  CONSTRAINT engine_workbook_import_batches_preview_digest_valid
    CHECK (preview_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_workbook_import_batches_status_valid CHECK (
    status IN (
      'preview_ready', 'preview_rejected', 'applied', 'no_op', 'expired',
      'superseded'
    )
  ),
  CONSTRAINT engine_workbook_import_batches_counts_nonnegative CHECK (
    recognized_sheet_count >= 0
    AND proposed_sheet_count >= 0
    AND unchanged_sheet_count >= 0
    AND missing_sheet_count >= 0
    AND invalid_sheet_count >= 0
    AND proposed_sheet_count + unchanged_sheet_count + invalid_sheet_count
      = recognized_sheet_count
  ),
  CONSTRAINT engine_workbook_import_batches_preview_window CHECK (
    received_at <= previewed_at
    AND preview_expires_at = previewed_at + interval '24 hours'
  ),
  CONSTRAINT engine_workbook_import_batches_completion_consistent CHECK (
    (
      status = 'preview_ready'
      AND confirmed_by_admin_id IS NULL
      AND confirmed_at IS NULL
      AND completed_at IS NULL
    )
    OR (
      status = 'preview_rejected'
      AND confirmed_by_admin_id IS NULL
      AND confirmed_at IS NULL
      AND completed_at IS NOT NULL
    )
    OR (
      status IN ('applied', 'no_op')
      AND confirmed_by_admin_id IS NOT NULL
      AND confirmed_at IS NOT NULL
      AND completed_at IS NOT NULL
      AND confirmed_at = completed_at
      AND confirmed_at <= preview_expires_at
    )
    OR (
      status IN ('expired', 'superseded')
      AND confirmed_by_admin_id IS NULL
      AND confirmed_at IS NULL
      AND completed_at IS NOT NULL
      AND (status = 'superseded' OR completed_at >= preview_expires_at)
    )
  ),
  UNIQUE (tournament_id, id),
  UNIQUE (tournament_id, id, workbook_id),
  UNIQUE (supersedes_batch_id)
);

ALTER TABLE engine_workbook_import_batches
  ADD CONSTRAINT engine_workbook_import_batches_supersedes_fk
  FOREIGN KEY (tournament_id, supersedes_batch_id)
  REFERENCES engine_workbook_import_batches(tournament_id, id)
  ON DELETE RESTRICT;

CREATE INDEX engine_workbook_import_batches_tournament_time_idx
  ON engine_workbook_import_batches (
    tournament_id, received_at DESC, id
  );

CREATE TABLE engine_workbook_import_observations (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  workbook_id uuid NOT NULL,
  workbook_sheet_id uuid,
  sheet_ordinal smallint,
  match_id uuid,
  observation_kind text NOT NULL,
  assignment_source text NOT NULL,
  disposition text NOT NULL,
  fingerprint text,
  base_match_row_version bigint,
  base_source_state_version bigint NOT NULL,
  source_envelope_schema_version integer,
  source_envelope_digest text,
  source_envelope jsonb,
  validation_issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  observed_at timestamptz NOT NULL,
  FOREIGN KEY (tournament_id, batch_id, workbook_id)
    REFERENCES engine_workbook_import_batches(tournament_id, id, workbook_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, workbook_id, workbook_sheet_id)
    REFERENCES engine_generated_workbook_sheets(
      tournament_id, workbook_id, sheet_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, match_id)
    REFERENCES engine_matches(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_workbook_import_observations_kind_valid
    CHECK (observation_kind IN ('present', 'missing')),
  CONSTRAINT engine_workbook_import_observations_assignment_valid CHECK (
    assignment_source IN (
      'stable_metadata', 'explicit_blank', 'exact_identity_fallback', 'none'
    )
  ),
  CONSTRAINT engine_workbook_import_observations_disposition_valid CHECK (
    disposition IN ('proposed', 'unchanged', 'missing', 'invalid', 'ambiguous')
  ),
  CONSTRAINT engine_workbook_import_observations_fingerprint_valid CHECK (
    fingerprint IS NULL OR fingerprint ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT engine_workbook_import_observations_base_versions_valid CHECK (
    (base_match_row_version IS NULL OR base_match_row_version > 0)
    AND base_source_state_version >= 0
  ),
  CONSTRAINT engine_workbook_import_observations_source_envelope_valid CHECK (
    (
      observation_kind = 'present'
      AND source_envelope_schema_version > 0
      AND source_envelope_digest ~ '^[a-f0-9]{64}$'
      AND source_envelope IS NOT NULL
    )
    OR (
      observation_kind = 'missing'
      AND source_envelope_schema_version IS NULL
      AND source_envelope_digest IS NULL
      AND source_envelope IS NULL
    )
  ),
  CONSTRAINT engine_workbook_import_observations_validation_issues_valid CHECK (
    engine_workbook_validation_issues_are_safe(validation_issues)
  ),
  CONSTRAINT engine_workbook_import_observations_presence_consistent CHECK (
    (
      observation_kind = 'present'
      AND sheet_ordinal > 0
      AND disposition <> 'missing'
      AND (
        disposition IN ('invalid', 'ambiguous')
        OR (
          match_id IS NOT NULL
          AND fingerprint IS NOT NULL
          AND base_match_row_version IS NOT NULL
          AND assignment_source <> 'none'
        )
      )
    )
    OR (
      observation_kind = 'missing'
      AND sheet_ordinal IS NULL
      AND workbook_sheet_id IS NOT NULL
      AND match_id IS NOT NULL
      AND assignment_source = 'none'
      AND disposition = 'missing'
      AND fingerprint IS NULL
      AND base_match_row_version IS NOT NULL
    )
  ),
  UNIQUE (tournament_id, batch_id, id),
  UNIQUE (tournament_id, batch_id, id, match_id)
);

CREATE UNIQUE INDEX engine_workbook_import_observations_present_ordinal_idx
  ON engine_workbook_import_observations (batch_id, sheet_ordinal)
  WHERE observation_kind = 'present';

CREATE UNIQUE INDEX engine_workbook_import_observations_missing_match_idx
  ON engine_workbook_import_observations (batch_id, match_id)
  WHERE observation_kind = 'missing';

CREATE TABLE engine_workbook_revision_candidates (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  match_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  observation_id uuid NOT NULL,
  previous_applied_candidate_id uuid,
  source_revision_number bigint NOT NULL,
  fingerprint text NOT NULL,
  participant_digest text NOT NULL,
  proposed_status text NOT NULL,
  proposed_score_availability text NOT NULL,
  reason text NOT NULL,
  requires_confirmation boolean NOT NULL,
  envelope_schema_version integer NOT NULL,
  envelope_digest text NOT NULL,
  envelope jsonb NOT NULL,
  base_match_row_version bigint NOT NULL,
  base_source_state_version bigint NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (tournament_id, match_id)
    REFERENCES engine_matches(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, batch_id, observation_id, match_id)
    REFERENCES engine_workbook_import_observations(
      tournament_id, batch_id, id, match_id
    ) ON DELETE RESTRICT,
  CONSTRAINT engine_workbook_revision_candidates_fingerprint_valid
    CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_workbook_revision_candidates_source_revision_positive
    CHECK (source_revision_number > 0),
  CONSTRAINT engine_workbook_revision_candidates_participant_digest_valid
    CHECK (participant_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_workbook_revision_candidates_schema_positive
    CHECK (envelope_schema_version > 0),
  CONSTRAINT engine_workbook_revision_candidates_status_valid CHECK (
    proposed_status IN (
      'scheduled', 'in_progress', 'final', 'forfeited', 'cancelled', 'postponed'
    )
  ),
  CONSTRAINT engine_workbook_revision_candidates_score_availability_valid CHECK (
    proposed_score_availability IN (
      'not_started', 'partial', 'complete', 'unrecorded', 'not_applicable'
    )
  ),
  CONSTRAINT engine_workbook_revision_candidates_reason_valid
    CHECK (reason IN ('initial', 'workbook_update', 'correction')),
  CONSTRAINT engine_workbook_revision_candidates_envelope_digest_valid
    CHECK (envelope_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_workbook_revision_candidates_base_versions_valid CHECK (
    base_match_row_version > 0 AND base_source_state_version >= 0
  ),
  UNIQUE (tournament_id, id),
  UNIQUE (tournament_id, match_id, id),
  UNIQUE (tournament_id, batch_id, observation_id),
  UNIQUE (tournament_id, batch_id, observation_id, match_id, id),
  FOREIGN KEY (tournament_id, match_id, previous_applied_candidate_id)
    REFERENCES engine_workbook_revision_candidates(tournament_id, match_id, id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX engine_workbook_revision_candidates_match_order_idx
  ON engine_workbook_revision_candidates (
    tournament_id, match_id, source_revision_number, created_at, id
  );

CREATE TABLE engine_workbook_revision_candidate_teams (
  tournament_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  side_number smallint NOT NULL,
  team_id uuid NOT NULL,
  display_name_at_import text NOT NULL,
  PRIMARY KEY (candidate_id, side_number),
  FOREIGN KEY (tournament_id, candidate_id)
    REFERENCES engine_workbook_revision_candidates(tournament_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, team_id)
    REFERENCES engine_teams(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_workbook_candidate_teams_side_valid
    CHECK (side_number IN (1, 2)),
  CONSTRAINT engine_workbook_candidate_teams_name_nonempty
    CHECK (length(btrim(display_name_at_import)) > 0),
  UNIQUE (tournament_id, candidate_id, side_number, team_id),
  UNIQUE (tournament_id, candidate_id, team_id)
);

CREATE FUNCTION engine_validate_workbook_candidate_team_match_slot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_team_id uuid;
BEGIN
  SELECT slot.team_id INTO expected_team_id
  FROM engine_workbook_revision_candidates candidate
  JOIN engine_match_slots slot
    ON slot.tournament_id = candidate.tournament_id
   AND slot.match_id = candidate.match_id
   AND slot.slot_number = NEW.side_number
  WHERE candidate.tournament_id = NEW.tournament_id
    AND candidate.id = NEW.candidate_id;
  IF NOT FOUND
     OR expected_team_id IS NULL
     OR NEW.team_id <> expected_team_id THEN
    RAISE EXCEPTION 'Workbook candidate team must match the stable match slot.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_workbook_candidate_team_match_slot_guard
  BEFORE INSERT OR UPDATE ON engine_workbook_revision_candidate_teams
  FOR EACH ROW EXECUTE FUNCTION engine_validate_workbook_candidate_team_match_slot();

CREATE TABLE engine_workbook_revision_candidate_players (
  tournament_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  side_number smallint NOT NULL,
  team_id uuid NOT NULL,
  player_id uuid NOT NULL,
  roster_membership_id uuid NOT NULL,
  roster_slot smallint NOT NULL,
  display_name_at_import text NOT NULL,
  PRIMARY KEY (candidate_id, side_number, player_id),
  FOREIGN KEY (tournament_id, candidate_id, side_number, team_id)
    REFERENCES engine_workbook_revision_candidate_teams(
      tournament_id, candidate_id, side_number, team_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, player_id)
    REFERENCES engine_players(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (
    tournament_id, roster_membership_id, team_id, player_id
  ) REFERENCES engine_roster_memberships(
    tournament_id, id, team_id, player_id
  ) ON DELETE RESTRICT,
  CONSTRAINT engine_workbook_candidate_players_slot_positive
    CHECK (roster_slot > 0),
  CONSTRAINT engine_workbook_candidate_players_name_nonempty
    CHECK (length(btrim(display_name_at_import)) > 0),
  UNIQUE (candidate_id, side_number, roster_slot),
  UNIQUE (tournament_id, candidate_id, player_id),
  UNIQUE (tournament_id, candidate_id, team_id, player_id)
);

CREATE TABLE engine_match_workbook_source_states (
  tournament_id uuid NOT NULL,
  match_id uuid NOT NULL,
  active_candidate_id uuid NOT NULL,
  active_fingerprint text NOT NULL,
  participant_digest text NOT NULL,
  source_batch_id uuid NOT NULL,
  source_observation_id uuid NOT NULL,
  row_version bigint NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tournament_id, match_id),
  FOREIGN KEY (tournament_id, match_id)
    REFERENCES engine_matches(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, match_id, active_candidate_id)
    REFERENCES engine_workbook_revision_candidates(tournament_id, match_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, source_batch_id, source_observation_id)
    REFERENCES engine_workbook_import_observations(
      tournament_id, batch_id, id
    ) ON DELETE RESTRICT,
  CONSTRAINT engine_match_workbook_source_states_fingerprint_valid
    CHECK (active_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_match_workbook_source_states_participant_digest_valid
    CHECK (participant_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_match_workbook_source_states_version_positive
    CHECK (row_version > 0)
);

CREATE TABLE engine_workbook_import_decisions (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  observation_id uuid NOT NULL,
  match_id uuid,
  candidate_id uuid,
  decision text NOT NULL,
  actor_kind text NOT NULL,
  administrator_id uuid REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  reason text,
  preview_digest text NOT NULL,
  decided_at timestamptz NOT NULL,
  FOREIGN KEY (tournament_id, batch_id, observation_id)
    REFERENCES engine_workbook_import_observations(
      tournament_id, batch_id, id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, match_id)
    REFERENCES engine_matches(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, candidate_id)
    REFERENCES engine_workbook_revision_candidates(tournament_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, match_id, candidate_id)
    REFERENCES engine_workbook_revision_candidates(tournament_id, match_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    tournament_id, batch_id, observation_id, match_id, candidate_id
  ) REFERENCES engine_workbook_revision_candidates(
    tournament_id, batch_id, observation_id, match_id, id
  ) ON DELETE RESTRICT,
  CONSTRAINT engine_workbook_import_decisions_decision_valid CHECK (
    decision IN ('accepted', 'skipped', 'no_op', 'missing_non_destructive')
  ),
  CONSTRAINT engine_workbook_import_decisions_actor_valid CHECK (
    (actor_kind = 'administrator' AND administrator_id IS NOT NULL)
    OR (actor_kind = 'system' AND administrator_id IS NULL)
  ),
  CONSTRAINT engine_workbook_import_decisions_reason_valid CHECK (
    reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 500
  ),
  CONSTRAINT engine_workbook_import_decisions_preview_digest_valid
    CHECK (preview_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_workbook_import_decisions_candidate_consistent CHECK (
    (
      decision IN ('accepted', 'skipped')
      AND match_id IS NOT NULL
      AND candidate_id IS NOT NULL
    )
    OR (
      decision IN ('no_op', 'missing_non_destructive')
      AND match_id IS NOT NULL
      AND candidate_id IS NULL
    )
  ),
  UNIQUE (batch_id, observation_id)
);

CREATE FUNCTION engine_validate_match_workbook_source_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate engine_workbook_revision_candidates%ROWTYPE;
  matching_team_count integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Active workbook source state cannot be deleted.'
      USING ERRCODE = '23514';
  END IF;
  SELECT * INTO candidate
  FROM engine_workbook_revision_candidates
  WHERE id = NEW.active_candidate_id
    AND tournament_id = NEW.tournament_id
    AND match_id = NEW.match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active workbook candidate does not belong to the match.'
      USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO matching_team_count
  FROM engine_workbook_revision_candidate_teams team
  JOIN engine_match_slots slot
    ON slot.tournament_id = candidate.tournament_id
   AND slot.match_id = candidate.match_id
   AND slot.slot_number = team.side_number
   AND slot.team_id = team.team_id
  WHERE team.tournament_id = candidate.tournament_id
    AND team.candidate_id = candidate.id;
  IF matching_team_count <> 2 THEN
    RAISE EXCEPTION 'Active workbook candidate requires both stable match teams.'
      USING ERRCODE = '23514';
  END IF;
  IF candidate.fingerprint <> NEW.active_fingerprint
     OR candidate.participant_digest <> NEW.participant_digest
     OR candidate.batch_id <> NEW.source_batch_id
     OR candidate.observation_id <> NEW.source_observation_id THEN
    RAISE EXCEPTION 'Active workbook source state must match its candidate.'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.row_version <> 1
       OR candidate.source_revision_number <> 1
       OR candidate.previous_applied_candidate_id IS NOT NULL THEN
      RAISE EXCEPTION 'Initial workbook source state must start at revision one.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.tournament_id <> OLD.tournament_id
     OR NEW.match_id <> OLD.match_id
     OR NEW.row_version <> OLD.row_version + 1
     OR candidate.source_revision_number <> OLD.row_version + 1
     OR candidate.previous_applied_candidate_id IS DISTINCT FROM OLD.active_candidate_id
     OR NEW.participant_digest <> OLD.participant_digest THEN
    RAISE EXCEPTION 'Workbook source state must advance one frozen-participant revision.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_match_workbook_source_states_guard
  BEFORE INSERT OR UPDATE OR DELETE ON engine_match_workbook_source_states
  FOR EACH ROW EXECUTE FUNCTION engine_validate_match_workbook_source_state();

CREATE FUNCTION engine_validate_workbook_batch_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'preview_ready'
     OR NEW.status NOT IN ('applied', 'no_op', 'expired', 'superseded') THEN
    RAISE EXCEPTION 'Workbook import batch status transition is invalid.'
      USING ERRCODE = '23514';
  END IF;
  IF (
    NEW.id,
    NEW.tournament_id,
    NEW.workbook_id,
    NEW.workbook_schema_version,
    NEW.source_workbook_digest,
    NEW.source_size_bytes,
    NEW.base_tournament_row_version,
    NEW.preview_digest,
    NEW.supersedes_batch_id,
    NEW.recognized_sheet_count,
    NEW.proposed_sheet_count,
    NEW.unchanged_sheet_count,
    NEW.missing_sheet_count,
    NEW.invalid_sheet_count,
    NEW.received_by_admin_id,
    NEW.received_at,
    NEW.previewed_at,
    NEW.preview_expires_at
  ) IS DISTINCT FROM (
    OLD.id,
    OLD.tournament_id,
    OLD.workbook_id,
    OLD.workbook_schema_version,
    OLD.source_workbook_digest,
    OLD.source_size_bytes,
    OLD.base_tournament_row_version,
    OLD.preview_digest,
    OLD.supersedes_batch_id,
    OLD.recognized_sheet_count,
    OLD.proposed_sheet_count,
    OLD.unchanged_sheet_count,
    OLD.missing_sheet_count,
    OLD.invalid_sheet_count,
    OLD.received_by_admin_id,
    OLD.received_at,
    OLD.previewed_at,
    OLD.preview_expires_at
  ) THEN
    RAISE EXCEPTION 'Workbook import batch preview fields are immutable.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_workbook_import_batches_forward_only
  BEFORE UPDATE ON engine_workbook_import_batches
  FOR EACH ROW EXECUTE FUNCTION engine_validate_workbook_batch_transition();

CREATE FUNCTION engine_reject_workbook_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Workbook reconciliation history is immutable.'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER engine_generated_workbooks_immutable
  BEFORE UPDATE OR DELETE ON engine_generated_workbooks
  FOR EACH ROW EXECUTE FUNCTION engine_reject_workbook_history_mutation();

CREATE TRIGGER engine_generated_workbook_sheets_immutable
  BEFORE UPDATE OR DELETE ON engine_generated_workbook_sheets
  FOR EACH ROW EXECUTE FUNCTION engine_reject_workbook_history_mutation();

CREATE TRIGGER engine_workbook_import_observations_immutable
  BEFORE UPDATE OR DELETE ON engine_workbook_import_observations
  FOR EACH ROW EXECUTE FUNCTION engine_reject_workbook_history_mutation();

CREATE TRIGGER engine_workbook_revision_candidates_immutable
  BEFORE UPDATE OR DELETE ON engine_workbook_revision_candidates
  FOR EACH ROW EXECUTE FUNCTION engine_reject_workbook_history_mutation();

CREATE TRIGGER engine_workbook_revision_candidate_teams_immutable
  BEFORE UPDATE OR DELETE ON engine_workbook_revision_candidate_teams
  FOR EACH ROW EXECUTE FUNCTION engine_reject_workbook_history_mutation();

CREATE TRIGGER engine_workbook_revision_candidate_players_immutable
  BEFORE UPDATE OR DELETE ON engine_workbook_revision_candidate_players
  FOR EACH ROW EXECUTE FUNCTION engine_reject_workbook_history_mutation();

CREATE TRIGGER engine_workbook_import_decisions_immutable
  BEFORE UPDATE OR DELETE ON engine_workbook_import_decisions
  FOR EACH ROW EXECUTE FUNCTION engine_reject_workbook_history_mutation();
