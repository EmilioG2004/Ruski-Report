CREATE TABLE engine_canonical_statistic_run_scopes (
  statistic_run_id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  run_order bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  run_kind text NOT NULL,
  match_id uuid,
  revision_id uuid,
  rules_version integer NOT NULL,
  created_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, statistic_run_id)
    REFERENCES engine_statistic_runs(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, match_id, revision_id)
    REFERENCES engine_match_revisions(tournament_id, match_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT engine_canonical_statistic_run_kind_valid CHECK (
    run_kind IN ('match_revision', 'tournament_aggregate')
  ),
  CONSTRAINT engine_canonical_statistic_run_scope_consistent CHECK (
    (
      run_kind = 'match_revision'
      AND match_id IS NOT NULL
      AND revision_id IS NOT NULL
    )
    OR (
      run_kind = 'tournament_aggregate'
      AND match_id IS NULL
      AND revision_id IS NULL
    )
  ),
  CONSTRAINT engine_canonical_statistic_run_rules_positive
    CHECK (rules_version > 0),
  UNIQUE (tournament_id, statistic_run_id),
  UNIQUE (tournament_id, run_order),
  UNIQUE (tournament_id, statistic_run_id, rules_version),
  UNIQUE (tournament_id, match_id, revision_id, rules_version),
  UNIQUE (
    tournament_id,
    match_id,
    revision_id,
    rules_version,
    statistic_run_id
  )
);

CREATE TABLE engine_canonical_statistic_values (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  statistic_run_id uuid NOT NULL,
  scope text NOT NULL,
  match_id uuid,
  pod_id uuid,
  stage text NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  metric text NOT NULL,
  numerator numeric,
  denominator numeric,
  value numeric,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, statistic_run_id)
    REFERENCES engine_canonical_statistic_run_scopes(
      tournament_id, statistic_run_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, match_id)
    REFERENCES engine_matches(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, pod_id)
    REFERENCES engine_pods(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_canonical_statistics_scope_valid
    CHECK (scope IN ('match', 'pod', 'tournament')),
  CONSTRAINT engine_canonical_statistics_scope_identity_consistent CHECK (
    (scope = 'match' AND match_id IS NOT NULL AND pod_id IS NULL)
    OR (scope = 'pod' AND match_id IS NULL AND pod_id IS NOT NULL)
    OR (scope = 'tournament' AND match_id IS NULL AND pod_id IS NULL)
  ),
  CONSTRAINT engine_canonical_statistics_stage_valid
    CHECK (stage IN ('pod', 'playoff', 'all')),
  CONSTRAINT engine_canonical_statistics_subject_valid
    CHECK (subject_type IN ('player', 'team')),
  CONSTRAINT engine_canonical_statistics_metric_valid CHECK (
    metric IN (
      'makes', 'misses', 'attempts', 'shooting_percentage',
      'splash_outs', 'guys', 'tris', 'dis', 'voms',
      'cups_scored', 'cups_against', 'cup_differential'
    )
  ),
  CONSTRAINT engine_canonical_statistics_metric_subject_valid CHECK (
    metric NOT IN ('cups_against', 'cup_differential')
    OR subject_type = 'team'
  ),
  CONSTRAINT engine_canonical_statistics_value_shape_valid CHECK (
    (
      metric IN (
        'makes', 'misses', 'attempts', 'splash_outs', 'guys',
        'tris', 'dis', 'voms', 'cups_scored', 'cups_against'
      )
      AND numerator IS NOT NULL
      AND numerator >= 0
      AND numerator = trunc(numerator)
      AND denominator IS NULL
      AND value IS NOT NULL
      AND value = numerator
    )
    OR (
      metric = 'cup_differential'
      AND numerator IS NOT NULL
      AND numerator = trunc(numerator)
      AND denominator IS NULL
      AND value IS NOT NULL
      AND value = numerator
    )
    OR (
      metric = 'shooting_percentage'
      AND numerator IS NOT NULL
      AND numerator >= 0
      AND numerator = trunc(numerator)
      AND denominator IS NOT NULL
      AND denominator >= 0
      AND denominator = trunc(denominator)
      AND numerator <= denominator
      AND (
        (denominator = 0 AND value IS NULL)
        OR (
          denominator > 0
          AND value IS NOT NULL
          AND abs(value - (numerator / denominator)) < 0.000000000001
          AND value BETWEEN 0 AND 1
        )
      )
    )
  ),
  UNIQUE NULLS NOT DISTINCT (
    statistic_run_id,
    scope,
    match_id,
    pod_id,
    stage,
    subject_type,
    subject_id,
    metric
  )
);

CREATE INDEX engine_canonical_statistics_subject_idx
  ON engine_canonical_statistic_values (
    tournament_id, subject_type, subject_id, stage, metric
  );

CREATE INDEX engine_canonical_statistics_match_idx
  ON engine_canonical_statistic_values (
    tournament_id, match_id, subject_type, subject_id, metric
  ) WHERE match_id IS NOT NULL;

CREATE TABLE engine_active_tournament_statistic_runs (
  tournament_id uuid PRIMARY KEY
    REFERENCES engine_tournaments(id) ON DELETE RESTRICT,
  statistic_run_id uuid NOT NULL,
  rules_version integer NOT NULL,
  activated_at timestamptz NOT NULL,
  FOREIGN KEY (tournament_id, statistic_run_id, rules_version)
    REFERENCES engine_canonical_statistic_run_scopes(
      tournament_id, statistic_run_id, rules_version
    ) ON DELETE RESTRICT,
  CONSTRAINT engine_active_tournament_statistic_rules_positive
    CHECK (rules_version > 0)
);

CREATE TABLE engine_workbook_candidate_materializations (
  candidate_id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  match_id uuid NOT NULL,
  revision_id uuid NOT NULL UNIQUE,
  match_statistic_run_id uuid NOT NULL UNIQUE,
  confirmation_digest text NOT NULL,
  adapter_version integer NOT NULL,
  rules_version integer NOT NULL,
  materialized_by_admin_id uuid NOT NULL
    REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  writer_fencing_token bigint NOT NULL,
  materialized_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, match_id, candidate_id)
    REFERENCES engine_workbook_revision_candidates(tournament_id, match_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, match_id, revision_id)
    REFERENCES engine_match_revisions(tournament_id, match_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    tournament_id,
    match_id,
    revision_id,
    rules_version,
    match_statistic_run_id
  ) REFERENCES engine_canonical_statistic_run_scopes(
    tournament_id,
    match_id,
    revision_id,
    rules_version,
    statistic_run_id
  ) ON DELETE RESTRICT,
  CONSTRAINT engine_workbook_materialization_confirmation_digest_valid
    CHECK (confirmation_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_workbook_materialization_versions_positive CHECK (
    adapter_version > 0 AND rules_version > 0
  ),
  CONSTRAINT engine_workbook_materialization_fence_positive
    CHECK (writer_fencing_token > 0),
  UNIQUE (tournament_id, candidate_id),
  UNIQUE (tournament_id, match_id, revision_id)
);

CREATE FUNCTION engine_validate_canonical_statistic_run_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_tournament_id uuid;
  run_rules_version integer;
  run_created_at timestamptz;
BEGIN
  SELECT tournament_id, rules_version, created_at
  INTO run_tournament_id, run_rules_version, run_created_at
  FROM engine_statistic_runs
  WHERE id = NEW.statistic_run_id;

  IF NOT FOUND
     OR run_tournament_id <> NEW.tournament_id
     OR run_rules_version <> NEW.rules_version
     OR run_created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION
      'Canonical statistic run scope must match its immutable run header.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_canonical_statistic_run_scope_guard
  BEFORE INSERT OR UPDATE ON engine_canonical_statistic_run_scopes
  FOR EACH ROW EXECUTE FUNCTION engine_validate_canonical_statistic_run_scope();

CREATE FUNCTION engine_validate_canonical_statistic_value()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_kind_value text;
  run_match_id uuid;
  run_revision_id uuid;
  match_stage text;
BEGIN
  SELECT run_kind, match_id, revision_id
  INTO run_kind_value, run_match_id, run_revision_id
  FROM engine_canonical_statistic_run_scopes
  WHERE statistic_run_id = NEW.statistic_run_id
    AND tournament_id = NEW.tournament_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical statistic value has no scoped run.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.subject_type = 'team' THEN
    IF NOT EXISTS (
      SELECT 1 FROM engine_teams
      WHERE tournament_id = NEW.tournament_id AND id = NEW.subject_id
    ) THEN
      RAISE EXCEPTION
        'Canonical team statistic subject must belong to the run tournament.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM engine_players
    WHERE tournament_id = NEW.tournament_id AND id = NEW.subject_id
  ) THEN
    RAISE EXCEPTION
      'Canonical player statistic subject must belong to the run tournament.'
      USING ERRCODE = '23514';
  END IF;

  IF run_kind_value = 'match_revision' THEN
    IF NEW.scope <> 'match' OR NEW.match_id <> run_match_id THEN
      RAISE EXCEPTION
        'A match-revision statistic run may contain only its match scope.'
        USING ERRCODE = '23514';
    END IF;
    SELECT stage INTO match_stage
    FROM engine_matches
    WHERE tournament_id = NEW.tournament_id AND id = NEW.match_id;
    IF (match_stage = 'pod_play' AND NEW.stage <> 'pod')
       OR (match_stage = 'playoffs' AND NEW.stage <> 'playoff')
       OR match_stage NOT IN ('pod_play', 'playoffs') THEN
      RAISE EXCEPTION
        'Match statistic stage must match the canonical match stage.'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.subject_type = 'team' AND NOT EXISTS (
      SELECT 1
      FROM engine_match_revision_teams
      WHERE tournament_id = NEW.tournament_id
        AND revision_id = run_revision_id
        AND team_id = NEW.subject_id
    ) THEN
      RAISE EXCEPTION
        'Match team statistic subjects must belong to the scoped revision.'
        USING ERRCODE = '23514';
    ELSIF NEW.subject_type = 'player' AND NOT EXISTS (
      SELECT 1
      FROM engine_match_revision_players
      WHERE tournament_id = NEW.tournament_id
        AND revision_id = run_revision_id
        AND player_id = NEW.subject_id
    ) THEN
      RAISE EXCEPTION
        'Match player statistic subjects must belong to the scoped revision.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.scope = 'match' THEN
    RAISE EXCEPTION
      'A tournament aggregate run cannot contain match-scoped values.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.scope = 'pod' THEN
    IF NEW.stage <> 'pod' THEN
      RAISE EXCEPTION 'Pod statistic values belong to the pod stage.'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.subject_type = 'team' AND NOT EXISTS (
      SELECT 1
      FROM engine_pod_teams
      WHERE tournament_id = NEW.tournament_id
        AND pod_id = NEW.pod_id
        AND team_id = NEW.subject_id
    ) THEN
      RAISE EXCEPTION
        'Pod team statistic subjects must belong to the scoped pod.'
        USING ERRCODE = '23514';
    ELSIF NEW.subject_type = 'player' AND NOT EXISTS (
      SELECT 1
      FROM engine_roster_memberships membership
      JOIN engine_pod_teams pod_team
        ON pod_team.tournament_id = membership.tournament_id
       AND pod_team.team_id = membership.team_id
      WHERE membership.tournament_id = NEW.tournament_id
        AND pod_team.pod_id = NEW.pod_id
        AND membership.player_id = NEW.subject_id
    ) THEN
      RAISE EXCEPTION
        'Pod player statistic subjects must belong to a team in the scoped pod.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_canonical_statistic_value_guard
  BEFORE INSERT OR UPDATE ON engine_canonical_statistic_values
  FOR EACH ROW EXECUTE FUNCTION engine_validate_canonical_statistic_value();

CREATE FUNCTION engine_validate_active_tournament_statistic_run()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  selected_created_at timestamptz;
  selected_run_order bigint;
  previous_created_at timestamptz;
  previous_run_order bigint;
BEGIN
  SELECT run.created_at, run.run_order
  INTO selected_created_at, selected_run_order
  FROM engine_canonical_statistic_run_scopes run
  WHERE run.tournament_id = NEW.tournament_id
    AND run.statistic_run_id = NEW.statistic_run_id
    AND run.rules_version = NEW.rules_version
    AND run.run_kind = 'tournament_aggregate';
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Active tournament statistics must select a tournament aggregate run.'
      USING ERRCODE = '23514';
  END IF;
  NEW.activated_at := selected_created_at;
  IF TG_OP = 'UPDATE' THEN
    SELECT run.created_at, run.run_order
    INTO previous_created_at, previous_run_order
    FROM engine_canonical_statistic_run_scopes run
    WHERE run.tournament_id = OLD.tournament_id
      AND run.statistic_run_id = OLD.statistic_run_id;
    IF NEW.tournament_id <> OLD.tournament_id
       OR NEW.rules_version < OLD.rules_version
       OR (
         NEW.statistic_run_id <> OLD.statistic_run_id
         AND (
           selected_created_at < previous_created_at
           OR (
             selected_created_at = previous_created_at
             AND selected_run_order <= previous_run_order
           )
         )
       ) THEN
      RAISE EXCEPTION 'Active tournament statistic runs move forward only.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_active_tournament_statistic_run_guard
  BEFORE INSERT OR UPDATE ON engine_active_tournament_statistic_runs
  FOR EACH ROW EXECUTE FUNCTION engine_validate_active_tournament_statistic_run();

CREATE FUNCTION engine_reject_active_tournament_statistic_run_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Active tournament statistic run pointers cannot be deleted.'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER engine_active_tournament_statistic_runs_no_delete
  BEFORE DELETE ON engine_active_tournament_statistic_runs
  FOR EACH ROW EXECUTE FUNCTION engine_reject_active_tournament_statistic_run_delete();

CREATE FUNCTION engine_validate_workbook_candidate_materialization()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_status text;
  candidate_availability text;
  candidate_reason text;
  revision_status text;
  revision_availability text;
  revision_reason text;
  revision_adapter text;
  revision_confirmation_digest text;
BEGIN
  SELECT proposed_status, proposed_score_availability, reason
  INTO candidate_status, candidate_availability, candidate_reason
  FROM engine_workbook_revision_candidates
  WHERE tournament_id = NEW.tournament_id
    AND match_id = NEW.match_id
    AND id = NEW.candidate_id;

  SELECT status, score_availability, reason, source_adapter, confirmation_digest
  INTO revision_status, revision_availability, revision_reason,
       revision_adapter, revision_confirmation_digest
  FROM engine_match_revisions
  WHERE tournament_id = NEW.tournament_id
    AND match_id = NEW.match_id
    AND id = NEW.revision_id;

  IF candidate_status IS NULL
     OR revision_status IS NULL
     OR candidate_status <> revision_status
     OR candidate_availability <> revision_availability
     OR candidate_reason <> revision_reason
     OR revision_adapter <> 'excel_import'
     OR revision_confirmation_digest IS DISTINCT FROM NEW.confirmation_digest THEN
    RAISE EXCEPTION
      'Workbook materialization must preserve candidate and revision provenance.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    (
      SELECT side_number, team_id
      FROM engine_workbook_revision_candidate_teams
      WHERE tournament_id = NEW.tournament_id
        AND candidate_id = NEW.candidate_id
      EXCEPT
      SELECT side_number, team_id
      FROM engine_match_revision_teams
      WHERE tournament_id = NEW.tournament_id
        AND revision_id = NEW.revision_id
    )
    UNION ALL
    (
      SELECT side_number, team_id
      FROM engine_match_revision_teams
      WHERE tournament_id = NEW.tournament_id
        AND revision_id = NEW.revision_id
      EXCEPT
      SELECT side_number, team_id
      FROM engine_workbook_revision_candidate_teams
      WHERE tournament_id = NEW.tournament_id
        AND candidate_id = NEW.candidate_id
    )
  ) THEN
    RAISE EXCEPTION
      'Workbook materialization teams must match the accepted candidate.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    (
      SELECT side_number, team_id, player_id, roster_membership_id, roster_slot
      FROM engine_workbook_revision_candidate_players
      WHERE tournament_id = NEW.tournament_id
        AND candidate_id = NEW.candidate_id
      EXCEPT
      SELECT side_number, team_id, player_id, roster_membership_id, roster_slot
      FROM engine_match_revision_players
      WHERE tournament_id = NEW.tournament_id
        AND revision_id = NEW.revision_id
    )
    UNION ALL
    (
      SELECT side_number, team_id, player_id, roster_membership_id, roster_slot
      FROM engine_match_revision_players
      WHERE tournament_id = NEW.tournament_id
        AND revision_id = NEW.revision_id
      EXCEPT
      SELECT side_number, team_id, player_id, roster_membership_id, roster_slot
      FROM engine_workbook_revision_candidate_players
      WHERE tournament_id = NEW.tournament_id
        AND candidate_id = NEW.candidate_id
    )
  ) THEN
    RAISE EXCEPTION
      'Workbook materialization players must match the accepted candidate.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_workbook_candidate_materialization_guard
  BEFORE INSERT OR UPDATE ON engine_workbook_candidate_materializations
  FOR EACH ROW EXECUTE FUNCTION engine_validate_workbook_candidate_materialization();

CREATE FUNCTION engine_validate_ruski_shot_scoring()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  selected_event_id uuid;
  game_type_value text;
  event_type_value text;
  outcome_value text;
  cup_delta_value integer;
  classification_value text;
  expected_cup_delta integer;
BEGIN
  selected_event_id := NEW.event_id;
  SELECT tournament.game_type,
         event.event_type,
         attempt.outcome,
         attempt.cup_delta,
         classification.classification
  INTO game_type_value,
       event_type_value,
       outcome_value,
       cup_delta_value,
       classification_value
  FROM engine_match_events event
  JOIN engine_match_revisions revision ON revision.id = event.revision_id
  JOIN engine_matches match ON match.id = revision.match_id
  JOIN engine_tournaments tournament ON tournament.id = match.tournament_id
  LEFT JOIN engine_shot_attempts attempt ON attempt.event_id = event.id
  LEFT JOIN engine_shot_classifications classification
    ON classification.event_id = event.id
  WHERE event.id = selected_event_id;

  IF game_type_value IS DISTINCT FROM 'ruski' THEN
    RETURN NEW;
  END IF;
  IF event_type_value <> 'shot_attempt' OR outcome_value IS NULL THEN
    RAISE EXCEPTION 'Ruski shot events require exactly one shot attempt.'
      USING ERRCODE = '23514';
  END IF;
  IF outcome_value = 'make' THEN
    IF classification_value IS NOT NULL THEN
      RAISE EXCEPTION 'A Ruski make cannot carry a miss classification.'
        USING ERRCODE = '23514';
    END IF;
    expected_cup_delta := 1;
  ELSE
    expected_cup_delta := CASE classification_value
      WHEN 'di' THEN 2
      WHEN 'tri' THEN 3
      ELSE 0
    END;
  END IF;
  IF cup_delta_value <> expected_cup_delta THEN
    RAISE EXCEPTION
      'Ruski shot cup effect does not match its outcome and classification.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER engine_ruski_shot_attempt_scoring_guard
  AFTER INSERT OR UPDATE ON engine_shot_attempts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION engine_validate_ruski_shot_scoring();

CREATE CONSTRAINT TRIGGER engine_ruski_shot_classification_scoring_guard
  AFTER INSERT OR UPDATE ON engine_shot_classifications
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION engine_validate_ruski_shot_scoring();

CREATE FUNCTION engine_validate_ruski_shot_event_has_attempt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.event_type = 'shot_attempt'
     AND EXISTS (
       SELECT 1
       FROM engine_match_revisions revision
       JOIN engine_matches match ON match.id = revision.match_id
       JOIN engine_tournaments tournament ON tournament.id = match.tournament_id
       WHERE revision.id = NEW.revision_id
         AND tournament.game_type = 'ruski'
     )
     AND NOT EXISTS (
       SELECT 1 FROM engine_shot_attempts attempt WHERE attempt.event_id = NEW.id
     ) THEN
    RAISE EXCEPTION 'Ruski shot events require a shot-attempt payload.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER engine_ruski_shot_event_attempt_guard
  AFTER INSERT OR UPDATE ON engine_match_events
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION engine_validate_ruski_shot_event_has_attempt();

CREATE FUNCTION engine_validate_match_revision_participant_freeze()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  comparison_revision_id uuid;
BEGIN
  SELECT COALESCE(NEW.previous_revision_id, match.active_revision_id)
  INTO comparison_revision_id
  FROM engine_matches match
  WHERE match.tournament_id = NEW.tournament_id
    AND match.id = NEW.match_id;

  IF comparison_revision_id IS NULL OR comparison_revision_id = NEW.id THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    (
      SELECT side_number, team_id, player_id, roster_membership_id, roster_slot
      FROM engine_match_revision_players
      WHERE tournament_id = NEW.tournament_id
        AND revision_id = comparison_revision_id
      EXCEPT
      SELECT side_number, team_id, player_id, roster_membership_id, roster_slot
      FROM engine_match_revision_players
      WHERE tournament_id = NEW.tournament_id
        AND revision_id = NEW.id
    )
    UNION ALL
    (
      SELECT side_number, team_id, player_id, roster_membership_id, roster_slot
      FROM engine_match_revision_players
      WHERE tournament_id = NEW.tournament_id
        AND revision_id = NEW.id
      EXCEPT
      SELECT side_number, team_id, player_id, roster_membership_id, roster_slot
      FROM engine_match_revision_players
      WHERE tournament_id = NEW.tournament_id
        AND revision_id = comparison_revision_id
    )
  ) THEN
    RAISE EXCEPTION
      'Match revision participants must preserve frozen side, team, player, membership, and roster slot identity.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER engine_match_revision_participant_freeze_guard
  AFTER INSERT ON engine_match_revisions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION engine_validate_match_revision_participant_freeze();

CREATE FUNCTION engine_validate_match_activation_participant_freeze()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.active_revision_id IS NULL
     OR NEW.active_revision_id IS NULL
     OR NEW.active_revision_id = OLD.active_revision_id THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    (
      SELECT side_number, team_id, player_id, roster_membership_id, roster_slot
      FROM engine_match_revision_players
      WHERE tournament_id = NEW.tournament_id
        AND revision_id = OLD.active_revision_id
      EXCEPT
      SELECT side_number, team_id, player_id, roster_membership_id, roster_slot
      FROM engine_match_revision_players
      WHERE tournament_id = NEW.tournament_id
        AND revision_id = NEW.active_revision_id
    )
    UNION ALL
    (
      SELECT side_number, team_id, player_id, roster_membership_id, roster_slot
      FROM engine_match_revision_players
      WHERE tournament_id = NEW.tournament_id
        AND revision_id = NEW.active_revision_id
      EXCEPT
      SELECT side_number, team_id, player_id, roster_membership_id, roster_slot
      FROM engine_match_revision_players
      WHERE tournament_id = NEW.tournament_id
        AND revision_id = OLD.active_revision_id
    )
  ) THEN
    RAISE EXCEPTION
      'Activating a correction must preserve frozen participant identity.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER engine_match_activation_participant_freeze_guard
  AFTER UPDATE OF active_revision_id ON engine_matches
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION engine_validate_match_activation_participant_freeze();

CREATE FUNCTION engine_reject_late_match_revision_artifact_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  selected_revision_id uuid;
  selected_tournament_id uuid;
  selected_match_id uuid;
BEGIN
  IF TG_TABLE_NAME IN (
    'engine_match_revision_teams',
    'engine_match_revision_players',
    'engine_match_events'
  ) THEN
    selected_revision_id := (to_jsonb(NEW) ->> 'revision_id')::uuid;
  ELSE
    SELECT event.revision_id
    INTO selected_revision_id
    FROM engine_match_events event
    WHERE event.id = (to_jsonb(NEW) ->> 'event_id')::uuid;
  END IF;

  SELECT revision.tournament_id, revision.match_id
  INTO selected_tournament_id, selected_match_id
  FROM engine_match_revisions revision
  WHERE revision.id = selected_revision_id;

  IF EXISTS (
    SELECT 1
    FROM engine_matches match
    WHERE match.tournament_id = selected_tournament_id
      AND match.id = selected_match_id
      AND match.active_revision_id = selected_revision_id
  ) OR EXISTS (
    SELECT 1
    FROM engine_match_revisions revision
    WHERE revision.tournament_id = selected_tournament_id
      AND revision.match_id = selected_match_id
      AND revision.previous_revision_id = selected_revision_id
  ) OR EXISTS (
    SELECT 1
    FROM engine_canonical_statistic_run_scopes scope
    WHERE scope.tournament_id = selected_tournament_id
      AND scope.match_id = selected_match_id
      AND scope.revision_id = selected_revision_id
  ) OR EXISTS (
    SELECT 1
    FROM engine_workbook_candidate_materializations materialization
    WHERE materialization.tournament_id = selected_tournament_id
      AND materialization.match_id = selected_match_id
      AND materialization.revision_id = selected_revision_id
  ) THEN
    RAISE EXCEPTION
      'Consumed match revision child artifacts are immutable.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_match_revision_teams_no_late_insert
  BEFORE INSERT ON engine_match_revision_teams
  FOR EACH ROW EXECUTE FUNCTION engine_reject_late_match_revision_artifact_insert();

CREATE TRIGGER engine_match_revision_players_no_late_insert
  BEFORE INSERT ON engine_match_revision_players
  FOR EACH ROW EXECUTE FUNCTION engine_reject_late_match_revision_artifact_insert();

CREATE TRIGGER engine_match_events_no_late_insert
  BEFORE INSERT ON engine_match_events
  FOR EACH ROW EXECUTE FUNCTION engine_reject_late_match_revision_artifact_insert();

CREATE TRIGGER engine_shot_attempts_no_late_insert
  BEFORE INSERT ON engine_shot_attempts
  FOR EACH ROW EXECUTE FUNCTION engine_reject_late_match_revision_artifact_insert();

CREATE TRIGGER engine_shot_classifications_no_late_insert
  BEFORE INSERT ON engine_shot_classifications
  FOR EACH ROW EXECUTE FUNCTION engine_reject_late_match_revision_artifact_insert();

CREATE FUNCTION engine_validate_ruski_revision_score_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  selected_revision_id uuid;
  selected_tournament_id uuid;
  game_type_value text;
  source_adapter_value text;
  status_value text;
  availability_value text;
  team_count integer;
  win_count integer;
  loss_count integer;
  cancelled_count integer;
  forfeited_count integer;
  winning_score integer;
  losing_score integer;
BEGIN
  selected_revision_id := NEW.id;

  SELECT revision.tournament_id, tournament.game_type,
         revision.source_adapter, revision.status, revision.score_availability
  INTO selected_tournament_id, game_type_value, source_adapter_value,
       status_value, availability_value
  FROM engine_match_revisions revision
  JOIN engine_tournaments tournament
    ON tournament.id = revision.tournament_id
  WHERE revision.id = selected_revision_id;

  IF game_type_value IS DISTINCT FROM 'ruski'
     OR source_adapter_value = 'legacy_backfill' THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (status_value IN ('scheduled', 'postponed')
      AND availability_value = 'not_started')
    OR (status_value = 'in_progress' AND availability_value = 'partial')
    OR (status_value = 'final'
      AND availability_value IN ('complete', 'unrecorded'))
    OR (status_value IN ('forfeited', 'cancelled')
      AND availability_value = 'not_applicable')
  ) THEN
    RAISE EXCEPTION
      'Canonical Ruski match status and score availability are inconsistent.'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer
  INTO team_count
  FROM engine_match_revision_teams
  WHERE tournament_id = selected_tournament_id
    AND revision_id = selected_revision_id;
  IF team_count <> 2 THEN
    RAISE EXCEPTION 'Canonical Ruski revisions require exactly two team scores.'
      USING ERRCODE = '23514';
  END IF;

  IF availability_value IN ('partial', 'complete') THEN
    IF EXISTS (
      SELECT 1
      FROM engine_match_revision_teams team
      LEFT JOIN engine_match_events event
        ON event.tournament_id = team.tournament_id
       AND event.revision_id = team.revision_id
       AND event.team_id = team.team_id
      LEFT JOIN engine_shot_attempts attempt ON attempt.event_id = event.id
      WHERE team.tournament_id = selected_tournament_id
        AND team.revision_id = selected_revision_id
      GROUP BY team.side_number, team.score
      HAVING team.score IS DISTINCT FROM COALESCE(sum(attempt.cup_delta), 0)
    ) THEN
      RAISE EXCEPTION
        'Canonical Ruski team scores must equal canonical shot cup effects.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF EXISTS (
    SELECT 1
    FROM engine_match_revision_teams
    WHERE tournament_id = selected_tournament_id
      AND revision_id = selected_revision_id
      AND score IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Unavailable Ruski scores must remain null.'
      USING ERRCODE = '23514';
  END IF;

  IF availability_value IN ('not_started', 'unrecorded', 'not_applicable')
     AND EXISTS (
       SELECT 1
       FROM engine_match_events
       WHERE tournament_id = selected_tournament_id
         AND revision_id = selected_revision_id
         AND event_type IN ('shot_attempt', 'vom')
     ) THEN
    RAISE EXCEPTION
      'Ruski scoring occurrences require an available score.'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) FILTER (WHERE result = 'win')::integer,
         count(*) FILTER (WHERE result = 'loss')::integer,
         count(*) FILTER (WHERE result = 'cancelled')::integer,
         count(*) FILTER (WHERE result = 'forfeited')::integer,
         max(score) FILTER (WHERE result = 'win'),
         max(score) FILTER (WHERE result = 'loss')
  INTO win_count, loss_count, cancelled_count, forfeited_count,
       winning_score, losing_score
  FROM engine_match_revision_teams
  WHERE tournament_id = selected_tournament_id
    AND revision_id = selected_revision_id;

  IF status_value IN ('scheduled', 'postponed', 'in_progress')
     OR (status_value = 'final' AND availability_value = 'unrecorded') THEN
    IF EXISTS (
      SELECT 1
      FROM engine_match_revision_teams
      WHERE tournament_id = selected_tournament_id
        AND revision_id = selected_revision_id
        AND result <> 'pending'
    ) THEN
      RAISE EXCEPTION
        'Unresolved Ruski revisions require pending team results.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF status_value = 'final' THEN
    IF win_count <> 1 OR loss_count <> 1
       OR winning_score IS NULL OR losing_score IS NULL
       OR winning_score <= losing_score THEN
      RAISE EXCEPTION
        'A complete final Ruski revision requires one score-derived winner.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF status_value = 'cancelled' AND cancelled_count <> 2 THEN
    RAISE EXCEPTION
      'A cancelled Ruski revision requires two cancelled team results.'
      USING ERRCODE = '23514';
  ELSIF status_value = 'forfeited'
        AND (win_count <> 1 OR forfeited_count <> 1) THEN
    RAISE EXCEPTION
      'A forfeited Ruski revision requires one winner and one forfeited team.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER engine_ruski_revision_score_projection_guard
  AFTER INSERT ON engine_match_revisions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION engine_validate_ruski_revision_score_projection();

CREATE TRIGGER engine_canonical_statistic_run_scopes_immutable
  BEFORE UPDATE OR DELETE ON engine_canonical_statistic_run_scopes
  FOR EACH ROW EXECUTE FUNCTION engine_reject_immutable_artifact_mutation();

CREATE TRIGGER engine_canonical_statistic_values_immutable
  BEFORE UPDATE OR DELETE ON engine_canonical_statistic_values
  FOR EACH ROW EXECUTE FUNCTION engine_reject_immutable_artifact_mutation();

CREATE TRIGGER engine_workbook_candidate_materializations_immutable
  BEFORE UPDATE OR DELETE ON engine_workbook_candidate_materializations
  FOR EACH ROW EXECUTE FUNCTION engine_reject_immutable_artifact_mutation();
