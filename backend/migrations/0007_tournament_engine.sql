CREATE TABLE engine_tournaments (
  id uuid PRIMARY KEY,
  public_key text NOT NULL UNIQUE
    REFERENCES tournaments(id) ON DELETE RESTRICT,
  game_type text NOT NULL,
  year integer NOT NULL,
  name text NOT NULL,
  lifecycle text NOT NULL DEFAULT 'draft_setup',
  visibility text NOT NULL DEFAULT 'private',
  row_version bigint NOT NULL DEFAULT 1,
  setup_published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT engine_tournaments_public_key_nonempty
    CHECK (length(btrim(public_key)) > 0),
  CONSTRAINT engine_tournaments_name_nonempty
    CHECK (length(btrim(name)) > 0),
  CONSTRAINT engine_tournaments_year_positive CHECK (year > 0),
  CONSTRAINT engine_tournaments_lifecycle_valid CHECK (
    lifecycle IN (
      'draft_setup',
      'setup_published',
      'pod_play',
      'seeding_review',
      'playoffs',
      'completed',
      'archived'
    )
  ),
  CONSTRAINT engine_tournaments_visibility_valid
    CHECK (visibility IN ('private', 'public')),
  CONSTRAINT engine_tournaments_row_version_positive CHECK (row_version > 0),
  CONSTRAINT engine_tournaments_publication_time_consistent CHECK (
    (lifecycle = 'draft_setup' AND setup_published_at IS NULL)
    OR (lifecycle <> 'draft_setup' AND setup_published_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX engine_tournaments_scope_id_idx
  ON engine_tournaments (id, game_type);

CREATE INDEX engine_tournaments_year_lifecycle_idx
  ON engine_tournaments (year DESC, lifecycle, updated_at DESC);

CREATE INDEX engine_tournaments_active_public_idx
  ON engine_tournaments (updated_at DESC, id)
  WHERE visibility = 'public'
    AND lifecycle IN (
      'setup_published', 'pod_play', 'seeding_review', 'playoffs'
    );

CREATE TABLE engine_tournament_configurations (
  tournament_id uuid PRIMARY KEY
    REFERENCES engine_tournaments(id) ON DELETE RESTRICT,
  format_version smallint NOT NULL,
  format_type text NOT NULL,
  team_count smallint NOT NULL,
  pod_count smallint NOT NULL,
  pod_sizes smallint[] NOT NULL,
  players_per_team smallint NOT NULL,
  games_per_pair smallint NOT NULL,
  qualifiers_per_pod smallint NOT NULL,
  bracket_size smallint NOT NULL,
  allow_byes boolean NOT NULL,
  standings_rules text[] NOT NULL,
  copied_from_preset_id text,
  locked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT engine_configuration_format_version_supported
    CHECK (format_version = 1),
  CONSTRAINT engine_configuration_format_type_valid
    CHECK (format_type = 'pod_and_single_elimination'),
  CONSTRAINT engine_configuration_counts_positive CHECK (
    team_count > 0
    AND pod_count > 0
    AND players_per_team > 0
    AND games_per_pair > 0
    AND qualifiers_per_pod > 0
    AND bracket_size > 1
  ),
  CONSTRAINT engine_configuration_pod_count_matches_sizes
    CHECK (cardinality(pod_sizes) = pod_count),
  CONSTRAINT engine_configuration_pod_sizes_positive
    CHECK (pod_sizes[1] IS NOT NULL AND 0 < ALL(pod_sizes)),
  CONSTRAINT engine_configuration_equal_pod_sizes
    CHECK (pod_sizes <@ ARRAY[pod_sizes[1]]),
  CONSTRAINT engine_configuration_team_count_matches_pods
    CHECK (team_count = pod_count * pod_sizes[1]),
  CONSTRAINT engine_configuration_qualifiers_fit_pod
    CHECK (qualifiers_per_pod <= pod_sizes[1]),
  CONSTRAINT engine_configuration_qualifiers_fit_bracket
    CHECK (pod_count * qualifiers_per_pod <= bracket_size),
  CONSTRAINT engine_configuration_byes_consistent CHECK (
    allow_byes OR pod_count * qualifiers_per_pod = bracket_size
  ),
  CONSTRAINT engine_configuration_bracket_power_of_two
    CHECK ((bracket_size & (bracket_size - 1)) = 0),
  CONSTRAINT engine_configuration_standings_rules_supported CHECK (
    standings_rules = ARRAY[
      'record',
      'cupDifferential',
      'teamShootingPercentage',
      'administratorResolution'
    ]::text[]
  )
);

CREATE TABLE engine_pods (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL
    REFERENCES engine_tournaments(id) ON DELETE RESTRICT,
  public_key text NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  sequence smallint NOT NULL,
  active_finalization_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT engine_pods_public_key_nonempty
    CHECK (length(btrim(public_key)) > 0),
  CONSTRAINT engine_pods_name_nonempty CHECK (length(btrim(name)) > 0),
  CONSTRAINT engine_pods_normalized_name_nonempty
    CHECK (length(btrim(normalized_name)) > 0),
  CONSTRAINT engine_pods_sequence_positive CHECK (sequence > 0),
  UNIQUE (tournament_id, id),
  UNIQUE (tournament_id, public_key),
  UNIQUE (tournament_id, normalized_name),
  UNIQUE (tournament_id, sequence)
);

CREATE TABLE engine_teams (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL
    REFERENCES engine_tournaments(id) ON DELETE RESTRICT,
  public_key text NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  sequence smallint NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT engine_teams_public_key_nonempty
    CHECK (length(btrim(public_key)) > 0),
  CONSTRAINT engine_teams_name_nonempty CHECK (length(btrim(name)) > 0),
  CONSTRAINT engine_teams_normalized_name_nonempty
    CHECK (length(btrim(normalized_name)) > 0),
  CONSTRAINT engine_teams_sequence_positive CHECK (sequence > 0),
  UNIQUE (tournament_id, id),
  UNIQUE (tournament_id, public_key),
  UNIQUE (tournament_id, normalized_name),
  UNIQUE (tournament_id, sequence)
);

CREATE TABLE engine_pod_teams (
  tournament_id uuid NOT NULL,
  pod_id uuid NOT NULL,
  team_id uuid NOT NULL,
  initial_seed smallint NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, team_id),
  FOREIGN KEY (tournament_id, pod_id)
    REFERENCES engine_pods(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, team_id)
    REFERENCES engine_teams(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_pod_teams_initial_seed_positive CHECK (initial_seed > 0),
  UNIQUE (tournament_id, pod_id, initial_seed)
);

CREATE INDEX engine_pod_teams_pod_idx
  ON engine_pod_teams (tournament_id, pod_id, initial_seed);

CREATE TABLE engine_players (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL
    REFERENCES engine_tournaments(id) ON DELETE RESTRICT,
  public_key text NOT NULL,
  display_name text NOT NULL,
  first_name text,
  last_name text,
  preferred_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT engine_players_public_key_nonempty
    CHECK (length(btrim(public_key)) > 0),
  CONSTRAINT engine_players_display_name_nonempty
    CHECK (length(btrim(display_name)) > 0),
  UNIQUE (tournament_id, id),
  UNIQUE (tournament_id, public_key)
);

CREATE TABLE engine_roster_memberships (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  public_key text NOT NULL,
  team_id uuid NOT NULL,
  player_id uuid NOT NULL,
  roster_slot smallint NOT NULL,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  opened_by text NOT NULL,
  closed_by text,
  replacement_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, team_id)
    REFERENCES engine_teams(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, player_id)
    REFERENCES engine_players(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_roster_memberships_slot_positive CHECK (roster_slot > 0),
  CONSTRAINT engine_roster_memberships_public_key_nonempty
    CHECK (length(btrim(public_key)) > 0),
  CONSTRAINT engine_roster_memberships_opened_by_nonempty
    CHECK (length(btrim(opened_by)) > 0),
  CONSTRAINT engine_roster_memberships_effective_range_valid
    CHECK (closed_at IS NULL OR closed_at > opened_at),
  CONSTRAINT engine_roster_memberships_closure_consistent CHECK (
    (closed_at IS NULL AND closed_by IS NULL)
    OR (closed_at IS NOT NULL AND closed_by IS NOT NULL)
  ),
  UNIQUE (tournament_id, id),
  UNIQUE (tournament_id, public_key),
  UNIQUE (tournament_id, id, team_id, player_id)
);

CREATE UNIQUE INDEX engine_roster_memberships_active_slot_idx
  ON engine_roster_memberships (tournament_id, team_id, roster_slot)
  WHERE closed_at IS NULL;

CREATE UNIQUE INDEX engine_roster_memberships_active_player_idx
  ON engine_roster_memberships (tournament_id, player_id)
  WHERE closed_at IS NULL;

CREATE INDEX engine_roster_memberships_team_history_idx
  ON engine_roster_memberships (tournament_id, team_id, opened_at, id);

CREATE TABLE engine_matches (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL
    REFERENCES engine_tournaments(id) ON DELETE RESTRICT,
  public_key text NOT NULL UNIQUE
    REFERENCES match_identities(match_id) ON DELETE RESTRICT,
  stage text NOT NULL,
  pod_id uuid,
  sequence integer,
  identity_only boolean NOT NULL DEFAULT false,
  status text,
  score_availability text NOT NULL DEFAULT 'not_started',
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  active_revision_id uuid,
  participants_frozen_at timestamptz,
  row_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, pod_id)
    REFERENCES engine_pods(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_matches_public_key_nonempty
    CHECK (length(btrim(public_key)) > 0),
  CONSTRAINT engine_matches_stage_valid
    CHECK (stage IN ('pod_play', 'playoffs', 'legacy_unknown')),
  CONSTRAINT engine_matches_stage_pod_consistent CHECK (
    (stage = 'pod_play' AND pod_id IS NOT NULL)
    OR (stage IN ('playoffs', 'legacy_unknown') AND pod_id IS NULL)
  ),
  CONSTRAINT engine_matches_identity_only_consistent CHECK (
    (
      identity_only
      AND stage = 'legacy_unknown'
      AND sequence IS NULL
      AND status IS NULL
    )
    OR (
      NOT identity_only
      AND stage IN ('pod_play', 'playoffs')
      AND sequence > 0
      AND status IS NOT NULL
    )
  ),
  CONSTRAINT engine_matches_status_valid CHECK (
    status IN (
      'scheduled', 'in_progress', 'final', 'forfeited', 'cancelled', 'postponed'
    )
  ),
  CONSTRAINT engine_matches_score_availability_valid CHECK (
    score_availability IN (
      'not_started', 'partial', 'complete', 'unrecorded', 'not_applicable'
    )
  ),
  CONSTRAINT engine_matches_row_version_positive CHECK (row_version > 0),
  UNIQUE (tournament_id, id),
  UNIQUE (tournament_id, stage, sequence)
);

CREATE INDEX engine_matches_tournament_status_idx
  ON engine_matches (tournament_id, stage, status, sequence);

CREATE INDEX engine_matches_pod_idx
  ON engine_matches (tournament_id, pod_id, sequence)
  WHERE pod_id IS NOT NULL;

CREATE FUNCTION engine_validate_match_identity_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM engine_tournaments tournament
    JOIN match_identities identity
      ON identity.match_id = NEW.public_key
     AND identity.tournament_id = tournament.public_key
    WHERE tournament.id = NEW.tournament_id
  ) THEN
    RAISE EXCEPTION 'Engine match identity must belong to its public tournament identity.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_matches_identity_scope_guard
  BEFORE INSERT OR UPDATE OF tournament_id, public_key ON engine_matches
  FOR EACH ROW EXECUTE FUNCTION engine_validate_match_identity_scope();

CREATE TABLE engine_match_slots (
  tournament_id uuid NOT NULL,
  match_id uuid NOT NULL,
  slot_number smallint NOT NULL,
  source_type text NOT NULL,
  team_id uuid,
  source_match_id uuid,
  seed integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (match_id, slot_number),
  FOREIGN KEY (tournament_id, match_id)
    REFERENCES engine_matches(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, team_id)
    REFERENCES engine_teams(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, source_match_id)
    REFERENCES engine_matches(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_match_slots_number_valid CHECK (slot_number IN (1, 2)),
  CONSTRAINT engine_match_slots_source_type_valid CHECK (
    source_type IN ('team', 'match_winner', 'bye', 'tbd')
  ),
  CONSTRAINT engine_match_slots_source_consistent CHECK (
    (source_type = 'team' AND team_id IS NOT NULL AND source_match_id IS NULL)
    OR (
      source_type = 'match_winner'
      AND source_match_id IS NOT NULL
    )
    OR (source_type = 'bye' AND team_id IS NULL AND source_match_id IS NULL)
    OR (source_type = 'tbd' AND team_id IS NULL AND source_match_id IS NULL)
  ),
  CONSTRAINT engine_match_slots_seed_positive CHECK (seed IS NULL OR seed > 0),
  CONSTRAINT engine_match_slots_not_self_sourced
    CHECK (source_match_id IS NULL OR source_match_id <> match_id),
  UNIQUE (tournament_id, match_id, slot_number, team_id)
);

CREATE INDEX engine_match_slots_team_idx
  ON engine_match_slots (tournament_id, team_id, match_id)
  WHERE team_id IS NOT NULL;

CREATE TABLE engine_match_revisions (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  match_id uuid NOT NULL,
  public_key text NOT NULL,
  revision_number integer NOT NULL,
  previous_revision_id uuid,
  status text NOT NULL,
  score_availability text NOT NULL,
  reason text NOT NULL,
  source_adapter text NOT NULL,
  source_reference text,
  actor_id text NOT NULL,
  correction_reason text,
  confirmation_digest text,
  created_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, match_id)
    REFERENCES engine_matches(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_match_revisions_number_positive CHECK (revision_number > 0),
  CONSTRAINT engine_match_revisions_public_key_nonempty
    CHECK (length(btrim(public_key)) > 0),
  CONSTRAINT engine_match_revisions_status_valid CHECK (
    status IN (
      'scheduled', 'in_progress', 'final', 'forfeited', 'cancelled', 'postponed'
    )
  ),
  CONSTRAINT engine_match_revisions_score_availability_valid CHECK (
    score_availability IN (
      'not_started', 'partial', 'complete', 'unrecorded', 'not_applicable'
    )
  ),
  CONSTRAINT engine_match_revisions_reason_valid CHECK (
    reason IN (
      'initial',
      'workbook_update',
      'correction',
      'operator_resolution',
      'in_app_scoring',
      'legacy_backfill'
    )
  ),
  CONSTRAINT engine_match_revisions_source_adapter_valid CHECK (
    source_adapter IN (
      'excel_import', 'in_app_live', 'operator_correction', 'legacy_backfill'
    )
  ),
  CONSTRAINT engine_match_revisions_actor_nonempty
    CHECK (length(btrim(actor_id)) > 0),
  CONSTRAINT engine_match_revisions_confirmation_digest_valid CHECK (
    confirmation_digest IS NULL OR confirmation_digest ~ '^[a-f0-9]{64}$'
  ),
  UNIQUE (match_id, revision_number),
  UNIQUE (match_id, public_key),
  UNIQUE (tournament_id, id),
  UNIQUE (tournament_id, match_id, id),
  FOREIGN KEY (tournament_id, match_id, previous_revision_id)
    REFERENCES engine_match_revisions(tournament_id, match_id, id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE engine_matches
  ADD CONSTRAINT engine_matches_active_revision_fk
  FOREIGN KEY (tournament_id, id, active_revision_id)
  REFERENCES engine_match_revisions(tournament_id, match_id, id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX engine_match_revisions_match_idx
  ON engine_match_revisions (tournament_id, match_id, revision_number DESC);

CREATE TABLE engine_match_revision_teams (
  tournament_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  side_number smallint NOT NULL,
  team_id uuid NOT NULL,
  score integer,
  result text NOT NULL DEFAULT 'pending',
  display_name_at_revision text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (revision_id, side_number),
  FOREIGN KEY (tournament_id, revision_id)
    REFERENCES engine_match_revisions(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, team_id)
    REFERENCES engine_teams(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_match_revision_teams_side_valid CHECK (side_number IN (1, 2)),
  CONSTRAINT engine_match_revision_teams_score_nonnegative
    CHECK (score IS NULL OR score >= 0),
  CONSTRAINT engine_match_revision_teams_result_valid CHECK (
    result IN ('pending', 'win', 'loss', 'tie', 'cancelled', 'forfeited')
  ),
  CONSTRAINT engine_match_revision_teams_display_name_nonempty
    CHECK (length(btrim(display_name_at_revision)) > 0),
  UNIQUE (tournament_id, revision_id, side_number, team_id),
  UNIQUE (tournament_id, revision_id, team_id),
  UNIQUE (revision_id, team_id)
);

CREATE TABLE engine_match_revision_players (
  tournament_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  side_number smallint NOT NULL,
  team_id uuid NOT NULL,
  player_id uuid NOT NULL,
  roster_membership_id uuid,
  roster_slot smallint NOT NULL,
  display_name_at_revision text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (revision_id, side_number, player_id),
  FOREIGN KEY (tournament_id, revision_id, side_number, team_id)
    REFERENCES engine_match_revision_teams(
      tournament_id, revision_id, side_number, team_id
    ) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, player_id)
    REFERENCES engine_players(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, roster_membership_id)
    REFERENCES engine_roster_memberships(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (
    tournament_id, roster_membership_id, team_id, player_id
  ) REFERENCES engine_roster_memberships(
    tournament_id, id, team_id, player_id
  ) ON DELETE RESTRICT,
  CONSTRAINT engine_match_revision_players_slot_positive CHECK (roster_slot > 0),
  CONSTRAINT engine_match_revision_players_display_name_nonempty
    CHECK (length(btrim(display_name_at_revision)) > 0),
  UNIQUE (revision_id, side_number, roster_slot),
  UNIQUE (tournament_id, revision_id, player_id),
  UNIQUE (tournament_id, revision_id, team_id, player_id)
);

CREATE TABLE engine_match_events (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  sequence integer NOT NULL,
  event_type text NOT NULL,
  team_id uuid,
  player_id uuid,
  occurred_at timestamptz,
  source_reference text,
  created_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, revision_id)
    REFERENCES engine_match_revisions(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, team_id)
    REFERENCES engine_teams(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, player_id)
    REFERENCES engine_players(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, revision_id, team_id)
    REFERENCES engine_match_revision_teams(tournament_id, revision_id, team_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, revision_id, player_id)
    REFERENCES engine_match_revision_players(tournament_id, revision_id, player_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, revision_id, team_id, player_id)
    REFERENCES engine_match_revision_players(
      tournament_id, revision_id, team_id, player_id
    ) ON DELETE RESTRICT,
  CONSTRAINT engine_match_events_sequence_positive CHECK (sequence > 0),
  CONSTRAINT engine_match_events_player_team_consistent
    CHECK (player_id IS NULL OR team_id IS NOT NULL),
  CONSTRAINT engine_match_events_shot_attribution_required CHECK (
    event_type <> 'shot_attempt'
    OR (team_id IS NOT NULL AND player_id IS NOT NULL)
  ),
  CONSTRAINT engine_match_events_type_valid CHECK (
    event_type IN (
      'shot_attempt',
      'vom',
      'forfeit',
      'cancellation',
      'postponement',
      'phase_transition',
      'operator_correction'
    )
  ),
  UNIQUE (revision_id, sequence),
  UNIQUE (revision_id, id)
);

CREATE INDEX engine_match_events_revision_type_idx
  ON engine_match_events (revision_id, event_type, sequence);

CREATE TABLE engine_shot_attempts (
  event_id uuid PRIMARY KEY
    REFERENCES engine_match_events(id) ON DELETE RESTRICT,
  outcome text NOT NULL,
  cup_delta integer NOT NULL DEFAULT 0,
  phase text,
  turn_number integer,
  team_turn_order smallint,
  shot_in_team_turn smallint,
  CONSTRAINT engine_shot_attempts_outcome_valid CHECK (outcome IN ('make', 'miss')),
  CONSTRAINT engine_shot_attempts_turn_positive CHECK (
    (turn_number IS NULL OR turn_number > 0)
    AND (team_turn_order IS NULL OR team_turn_order > 0)
    AND (shot_in_team_turn IS NULL OR shot_in_team_turn > 0)
  )
);

CREATE TABLE engine_shot_classifications (
  event_id uuid PRIMARY KEY
    REFERENCES engine_shot_attempts(event_id) ON DELETE RESTRICT,
  classification text NOT NULL,
  CONSTRAINT engine_shot_classifications_value_valid
    CHECK (classification IN ('guy', 'di', 'tri', 'splash_out'))
);

CREATE TABLE engine_match_writer_leases (
  match_id uuid PRIMARY KEY
    REFERENCES engine_matches(id) ON DELETE RESTRICT,
  mode text NOT NULL,
  holder_id text NOT NULL,
  fencing_token bigint NOT NULL,
  acquired_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT engine_match_writer_leases_mode_valid CHECK (
    mode IN ('excel_import', 'in_app_live', 'operator_correction')
  ),
  CONSTRAINT engine_match_writer_leases_holder_nonempty
    CHECK (length(btrim(holder_id)) > 0),
  CONSTRAINT engine_match_writer_leases_fence_positive CHECK (fencing_token > 0),
  CONSTRAINT engine_match_writer_leases_expiration_valid CHECK (expires_at > acquired_at),
  CONSTRAINT engine_match_writer_leases_release_valid CHECK (
    released_at IS NULL OR released_at >= acquired_at
  )
);

CREATE TABLE engine_statistic_runs (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL
    REFERENCES engine_tournaments(id) ON DELETE RESTRICT,
  input_digest text NOT NULL,
  rules_version integer NOT NULL,
  created_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT engine_statistic_runs_digest_valid
    CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_statistic_runs_rules_version_positive CHECK (rules_version > 0),
  UNIQUE (tournament_id, input_digest, rules_version),
  UNIQUE (tournament_id, id)
);

CREATE TABLE engine_statistics (
  statistic_run_id uuid NOT NULL
    REFERENCES engine_statistic_runs(id) ON DELETE RESTRICT,
  scope text NOT NULL,
  stage text NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  metric text NOT NULL,
  numerator numeric,
  denominator numeric,
  value numeric,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (
    statistic_run_id, scope, stage, subject_type, subject_id, metric
  ),
  CONSTRAINT engine_statistics_scope_valid
    CHECK (scope IN ('match', 'pod', 'tournament')),
  CONSTRAINT engine_statistics_stage_valid CHECK (stage IN ('pod', 'playoff', 'all')),
  CONSTRAINT engine_statistics_subject_valid CHECK (subject_type IN ('player', 'team')),
  CONSTRAINT engine_statistics_metric_nonempty CHECK (length(btrim(metric)) > 0),
  CONSTRAINT engine_statistics_denominator_nonnegative
    CHECK (denominator IS NULL OR denominator >= 0)
);

CREATE TABLE engine_standing_calculations (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  scope text NOT NULL,
  pod_id uuid,
  input_digest text NOT NULL,
  rules_version integer NOT NULL,
  status text NOT NULL,
  calculation_input jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, pod_id)
    REFERENCES engine_pods(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_standing_calculations_scope_valid
    CHECK (scope IN ('pod', 'tournament')),
  CONSTRAINT engine_standing_calculations_scope_pod_consistent CHECK (
    (scope = 'pod' AND pod_id IS NOT NULL)
    OR (scope = 'tournament' AND pod_id IS NULL)
  ),
  CONSTRAINT engine_standing_calculations_digest_valid
    CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_standing_calculations_rules_version_positive
    CHECK (rules_version > 0),
  CONSTRAINT engine_standing_calculations_status_valid
    CHECK (status IN ('provisional', 'unresolved_tie', 'finalizable')),
  UNIQUE NULLS NOT DISTINCT (
    tournament_id, pod_id, input_digest, rules_version
  ),
  UNIQUE (tournament_id, pod_id, id),
  UNIQUE (tournament_id, id)
);

CREATE TABLE engine_standing_rows (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  calculation_id uuid NOT NULL,
  team_id uuid NOT NULL,
  public_key text NOT NULL,
  rank integer,
  tie_group text,
  wins integer NOT NULL,
  losses integer NOT NULL,
  cup_differential integer NOT NULL,
  makes integer,
  attempts integer,
  shooting_percentage numeric,
  qualified boolean NOT NULL DEFAULT false,
  administrator_resolution text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, calculation_id)
    REFERENCES engine_standing_calculations(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, team_id)
    REFERENCES engine_teams(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_standing_rows_rank_positive CHECK (rank IS NULL OR rank > 0),
  CONSTRAINT engine_standing_rows_public_key_nonempty
    CHECK (length(btrim(public_key)) > 0),
  CONSTRAINT engine_standing_rows_counts_nonnegative CHECK (
    wins >= 0
    AND losses >= 0
    AND (
      (makes IS NULL AND attempts IS NULL)
      OR (
        makes IS NOT NULL
        AND attempts IS NOT NULL
        AND makes >= 0
        AND attempts >= 0
        AND makes <= attempts
      )
    )
  ),
  CONSTRAINT engine_standing_rows_percentage_valid CHECK (
    shooting_percentage IS NULL
    OR (shooting_percentage >= 0 AND shooting_percentage <= 1)
  ),
  UNIQUE (calculation_id, team_id),
  UNIQUE (tournament_id, public_key),
  UNIQUE (tournament_id, id)
);

CREATE TABLE engine_pod_finalizations (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  pod_id uuid NOT NULL,
  calculation_id uuid NOT NULL,
  finalized_by text NOT NULL,
  reason text,
  finalized_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, pod_id, calculation_id)
    REFERENCES engine_standing_calculations(tournament_id, pod_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT engine_pod_finalizations_actor_nonempty
    CHECK (length(btrim(finalized_by)) > 0),
  UNIQUE (tournament_id, pod_id, calculation_id),
  UNIQUE (tournament_id, pod_id, id)
);

ALTER TABLE engine_pods
  ADD CONSTRAINT engine_pods_active_finalization_fk
  FOREIGN KEY (tournament_id, id, active_finalization_id)
  REFERENCES engine_pod_finalizations(tournament_id, pod_id, id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE engine_seed_calculations (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL
    REFERENCES engine_tournaments(id) ON DELETE RESTRICT,
  input_digest text NOT NULL,
  rules_version integer NOT NULL,
  created_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT engine_seed_calculations_digest_valid
    CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_seed_calculations_rules_version_positive CHECK (rules_version > 0),
  UNIQUE (tournament_id, input_digest, rules_version),
  UNIQUE (tournament_id, id)
);

CREATE TABLE engine_seed_rows (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  calculation_id uuid NOT NULL,
  team_id uuid NOT NULL,
  public_key text NOT NULL,
  calculated_seed integer NOT NULL,
  qualified boolean NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, calculation_id)
    REFERENCES engine_seed_calculations(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, team_id)
    REFERENCES engine_teams(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_seed_rows_seed_positive CHECK (calculated_seed > 0),
  CONSTRAINT engine_seed_rows_public_key_nonempty
    CHECK (length(btrim(public_key)) > 0),
  UNIQUE (calculation_id, team_id),
  UNIQUE (tournament_id, public_key),
  UNIQUE (calculation_id, calculated_seed),
  UNIQUE (tournament_id, id)
);

CREATE TABLE engine_seed_overrides (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  team_id uuid NOT NULL,
  previous_seed integer NOT NULL,
  new_seed integer NOT NULL,
  reason text NOT NULL,
  overridden_by text NOT NULL,
  overridden_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, team_id)
    REFERENCES engine_teams(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_seed_overrides_seed_positive
    CHECK (previous_seed > 0 AND new_seed > 0),
  CONSTRAINT engine_seed_overrides_seed_changed CHECK (previous_seed <> new_seed),
  CONSTRAINT engine_seed_overrides_reason_nonempty CHECK (length(btrim(reason)) > 0),
  CONSTRAINT engine_seed_overrides_actor_nonempty
    CHECK (length(btrim(overridden_by)) > 0),
  UNIQUE (tournament_id, team_id, id)
);

CREATE TABLE engine_effective_seeds (
  tournament_id uuid NOT NULL,
  team_id uuid NOT NULL,
  calculated_seed integer NOT NULL,
  effective_seed integer NOT NULL,
  override_id uuid,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tournament_id, team_id),
  FOREIGN KEY (tournament_id, team_id)
    REFERENCES engine_teams(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, team_id, override_id)
    REFERENCES engine_seed_overrides(tournament_id, team_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_effective_seeds_positive
    CHECK (calculated_seed > 0 AND effective_seed > 0),
  UNIQUE (tournament_id, effective_seed)
);

CREATE TABLE engine_brackets (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL
    REFERENCES engine_tournaments(id) ON DELETE RESTRICT,
  public_key text NOT NULL,
  name text NOT NULL,
  bracket_size integer NOT NULL,
  placement_policy text NOT NULL,
  status text NOT NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT engine_brackets_public_key_nonempty
    CHECK (length(btrim(public_key)) > 0),
  CONSTRAINT engine_brackets_name_nonempty CHECK (length(btrim(name)) > 0),
  CONSTRAINT engine_brackets_size_power_of_two CHECK (
    bracket_size > 1 AND (bracket_size & (bracket_size - 1)) = 0
  ),
  CONSTRAINT engine_brackets_placement_policy_valid
    CHECK (placement_policy = 'standard_mirrored_seeded'),
  CONSTRAINT engine_brackets_status_valid CHECK (status IN ('draft', 'published', 'completed')),
  CONSTRAINT engine_brackets_publication_consistent CHECK (
    (status = 'draft' AND published_at IS NULL)
    OR (status <> 'draft' AND published_at IS NOT NULL)
  ),
  UNIQUE (tournament_id, id),
  UNIQUE (tournament_id, public_key)
);

CREATE TABLE engine_bracket_rounds (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  bracket_id uuid NOT NULL,
  public_key text NOT NULL,
  name text NOT NULL,
  sequence integer NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, bracket_id)
    REFERENCES engine_brackets(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_bracket_rounds_public_key_nonempty
    CHECK (length(btrim(public_key)) > 0),
  CONSTRAINT engine_bracket_rounds_name_nonempty CHECK (length(btrim(name)) > 0),
  CONSTRAINT engine_bracket_rounds_sequence_positive CHECK (sequence > 0),
  UNIQUE (tournament_id, id),
  UNIQUE (tournament_id, bracket_id, id),
  UNIQUE (bracket_id, public_key),
  UNIQUE (bracket_id, sequence)
);

CREATE TABLE engine_bracket_matches (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  bracket_id uuid NOT NULL,
  round_id uuid NOT NULL,
  match_id uuid NOT NULL,
  public_key text NOT NULL,
  sequence integer NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, bracket_id, round_id)
    REFERENCES engine_bracket_rounds(tournament_id, bracket_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, match_id)
    REFERENCES engine_matches(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_bracket_matches_public_key_nonempty
    CHECK (length(btrim(public_key)) > 0),
  CONSTRAINT engine_bracket_matches_sequence_positive CHECK (sequence > 0),
  UNIQUE (tournament_id, id),
  UNIQUE (tournament_id, bracket_id, id),
  UNIQUE (bracket_id, public_key),
  UNIQUE (round_id, sequence),
  UNIQUE (match_id)
);

CREATE TABLE engine_bracket_slots (
  id uuid PRIMARY KEY,
  tournament_id uuid NOT NULL,
  bracket_match_id uuid NOT NULL,
  public_key text NOT NULL,
  slot_number smallint NOT NULL,
  source_type text NOT NULL,
  team_id uuid,
  source_bracket_match_id uuid,
  seed integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, bracket_match_id)
    REFERENCES engine_bracket_matches(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, team_id)
    REFERENCES engine_teams(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, source_bracket_match_id)
    REFERENCES engine_bracket_matches(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_bracket_slots_number_valid CHECK (slot_number IN (1, 2)),
  CONSTRAINT engine_bracket_slots_public_key_nonempty
    CHECK (length(btrim(public_key)) > 0),
  CONSTRAINT engine_bracket_slots_source_type_valid CHECK (
    source_type IN ('team', 'match_winner', 'bye', 'tbd')
  ),
  CONSTRAINT engine_bracket_slots_source_consistent CHECK (
    (source_type = 'team' AND team_id IS NOT NULL AND source_bracket_match_id IS NULL)
    OR (
      source_type = 'match_winner'
      AND source_bracket_match_id IS NOT NULL
    )
    OR (source_type = 'bye' AND team_id IS NULL AND source_bracket_match_id IS NULL)
    OR (source_type = 'tbd' AND team_id IS NULL AND source_bracket_match_id IS NULL)
  ),
  CONSTRAINT engine_bracket_slots_seed_positive CHECK (seed IS NULL OR seed > 0),
  CONSTRAINT engine_bracket_slots_not_self_sourced CHECK (
    source_bracket_match_id IS NULL OR source_bracket_match_id <> bracket_match_id
  ),
  UNIQUE (tournament_id, id),
  UNIQUE (bracket_match_id, slot_number),
  UNIQUE (bracket_match_id, public_key)
);

CREATE TABLE engine_audit_events (
  id uuid PRIMARY KEY,
  tournament_id uuid
    REFERENCES engine_tournaments(id) ON DELETE RESTRICT,
  match_id uuid
    REFERENCES engine_matches(id) ON DELETE RESTRICT,
  command_type text NOT NULL,
  actor_kind text NOT NULL,
  actor_id text,
  correlation_id uuid,
  causation_id uuid,
  occurred_at timestamptz NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT engine_audit_events_command_nonempty
    CHECK (length(btrim(command_type)) > 0),
  CONSTRAINT engine_audit_events_actor_kind_valid
    CHECK (actor_kind IN ('administrator', 'system', 'legacy_backfill')),
  CONSTRAINT engine_audit_events_actor_consistent CHECK (
    (actor_kind = 'system' AND actor_id IS NULL)
    OR (actor_kind <> 'system' AND actor_id IS NOT NULL AND length(btrim(actor_id)) > 0)
  )
);

CREATE INDEX engine_audit_events_tournament_idx
  ON engine_audit_events (tournament_id, occurred_at DESC, id);

CREATE INDEX engine_audit_events_match_idx
  ON engine_audit_events (match_id, occurred_at DESC, id)
  WHERE match_id IS NOT NULL;

CREATE TABLE engine_legacy_backfill_runs (
  id uuid PRIMARY KEY,
  legacy_tournament_id text NOT NULL
    REFERENCES tournaments(id) ON DELETE RESTRICT,
  source_snapshot_version integer NOT NULL,
  tool_version integer NOT NULL,
  source_digest text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (legacy_tournament_id, source_snapshot_version)
    REFERENCES tournament_snapshot_versions(tournament_id, version)
    ON DELETE RESTRICT,
  CONSTRAINT engine_legacy_backfill_runs_tool_version_positive CHECK (tool_version > 0),
  CONSTRAINT engine_legacy_backfill_runs_digest_valid
    CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_legacy_backfill_runs_status_valid
    CHECK (status IN ('running', 'completed', 'failed', 'no_op')),
  CONSTRAINT engine_legacy_backfill_runs_completion_consistent CHECK (
    (status = 'running' AND completed_at IS NULL)
    OR (status <> 'running' AND completed_at IS NOT NULL)
  ),
  UNIQUE (
    legacy_tournament_id, source_snapshot_version, tool_version, source_digest
  )
);

CREATE TABLE engine_legacy_tournament_links (
  engine_tournament_id uuid PRIMARY KEY
    REFERENCES engine_tournaments(id) ON DELETE RESTRICT,
  legacy_tournament_id text NOT NULL UNIQUE
    REFERENCES tournaments(id) ON DELETE RESTRICT,
  source_snapshot_version integer NOT NULL,
  backfill_run_id uuid NOT NULL
    REFERENCES engine_legacy_backfill_runs(id) ON DELETE RESTRICT,
  FOREIGN KEY (legacy_tournament_id, source_snapshot_version)
    REFERENCES tournament_snapshot_versions(tournament_id, version)
    ON DELETE RESTRICT
);

CREATE TABLE engine_legacy_team_links (
  engine_team_id uuid PRIMARY KEY,
  engine_tournament_id uuid NOT NULL,
  legacy_tournament_id text NOT NULL,
  source_snapshot_version integer NOT NULL,
  legacy_team_id text NOT NULL,
  backfill_run_id uuid NOT NULL
    REFERENCES engine_legacy_backfill_runs(id) ON DELETE RESTRICT,
  FOREIGN KEY (engine_tournament_id, engine_team_id)
    REFERENCES engine_teams(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (legacy_tournament_id, source_snapshot_version, legacy_team_id)
    REFERENCES teams(tournament_id, snapshot_version, team_id)
    ON DELETE RESTRICT,
  UNIQUE (legacy_tournament_id, source_snapshot_version, legacy_team_id)
);

CREATE TABLE engine_legacy_player_links (
  engine_player_id uuid PRIMARY KEY,
  engine_tournament_id uuid NOT NULL,
  legacy_tournament_id text NOT NULL,
  source_snapshot_version integer NOT NULL,
  legacy_player_id text NOT NULL,
  backfill_run_id uuid NOT NULL
    REFERENCES engine_legacy_backfill_runs(id) ON DELETE RESTRICT,
  FOREIGN KEY (engine_tournament_id, engine_player_id)
    REFERENCES engine_players(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (legacy_tournament_id, source_snapshot_version, legacy_player_id)
    REFERENCES players(tournament_id, snapshot_version, player_id)
    ON DELETE RESTRICT,
  UNIQUE (legacy_tournament_id, source_snapshot_version, legacy_player_id)
);

CREATE TABLE engine_legacy_roster_membership_links (
  engine_roster_membership_id uuid PRIMARY KEY,
  engine_tournament_id uuid NOT NULL,
  legacy_tournament_id text NOT NULL,
  source_snapshot_version integer NOT NULL,
  legacy_team_id text NOT NULL,
  legacy_player_id text NOT NULL,
  legacy_sequence integer NOT NULL,
  backfill_run_id uuid NOT NULL
    REFERENCES engine_legacy_backfill_runs(id) ON DELETE RESTRICT,
  FOREIGN KEY (engine_tournament_id, engine_roster_membership_id)
    REFERENCES engine_roster_memberships(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (
    legacy_tournament_id,
    source_snapshot_version,
    legacy_team_id,
    legacy_player_id
  ) REFERENCES team_players(
    tournament_id, snapshot_version, team_id, player_id
  ) ON DELETE RESTRICT,
  CONSTRAINT engine_legacy_roster_membership_sequence_positive
    CHECK (legacy_sequence > 0),
  UNIQUE (
    legacy_tournament_id,
    source_snapshot_version,
    legacy_team_id,
    legacy_player_id
  )
);

CREATE TABLE engine_legacy_pod_links (
  engine_pod_id uuid PRIMARY KEY,
  engine_tournament_id uuid NOT NULL,
  legacy_tournament_id text NOT NULL,
  source_snapshot_version integer NOT NULL,
  legacy_pod_id text NOT NULL,
  backfill_run_id uuid NOT NULL
    REFERENCES engine_legacy_backfill_runs(id) ON DELETE RESTRICT,
  FOREIGN KEY (engine_tournament_id, engine_pod_id)
    REFERENCES engine_pods(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (legacy_tournament_id, source_snapshot_version, legacy_pod_id)
    REFERENCES pods(tournament_id, snapshot_version, pod_id)
    ON DELETE RESTRICT,
  UNIQUE (legacy_tournament_id, source_snapshot_version, legacy_pod_id)
);

CREATE TABLE engine_legacy_match_links (
  engine_match_id uuid PRIMARY KEY,
  engine_tournament_id uuid NOT NULL,
  legacy_tournament_id text NOT NULL,
  source_snapshot_version integer,
  legacy_match_id text NOT NULL UNIQUE
    REFERENCES match_identities(match_id) ON DELETE RESTRICT,
  backfill_run_id uuid NOT NULL
    REFERENCES engine_legacy_backfill_runs(id) ON DELETE RESTRICT,
  FOREIGN KEY (engine_tournament_id, engine_match_id)
    REFERENCES engine_matches(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (legacy_tournament_id, source_snapshot_version, legacy_match_id)
    REFERENCES matches(tournament_id, snapshot_version, match_id)
    ON DELETE RESTRICT
);

CREATE TABLE engine_legacy_match_revision_links (
  engine_match_revision_id uuid PRIMARY KEY,
  engine_tournament_id uuid NOT NULL,
  engine_match_id uuid NOT NULL,
  legacy_tournament_id text NOT NULL,
  source_snapshot_version integer NOT NULL,
  legacy_match_id text NOT NULL,
  backfill_run_id uuid NOT NULL
    REFERENCES engine_legacy_backfill_runs(id) ON DELETE RESTRICT,
  FOREIGN KEY (
    engine_tournament_id, engine_match_id, engine_match_revision_id
  ) REFERENCES engine_match_revisions(tournament_id, match_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (legacy_tournament_id, source_snapshot_version, legacy_match_id)
    REFERENCES matches(tournament_id, snapshot_version, match_id)
    ON DELETE RESTRICT,
  UNIQUE (legacy_tournament_id, source_snapshot_version, legacy_match_id)
);

CREATE TABLE engine_legacy_standing_links (
  engine_standing_row_id uuid PRIMARY KEY,
  engine_tournament_id uuid NOT NULL,
  legacy_tournament_id text NOT NULL,
  source_snapshot_version integer NOT NULL,
  legacy_standing_id text NOT NULL,
  backfill_run_id uuid NOT NULL
    REFERENCES engine_legacy_backfill_runs(id) ON DELETE RESTRICT,
  FOREIGN KEY (engine_tournament_id, engine_standing_row_id)
    REFERENCES engine_standing_rows(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (
    legacy_tournament_id, source_snapshot_version, legacy_standing_id
  ) REFERENCES standings(tournament_id, snapshot_version, standing_id)
    ON DELETE RESTRICT,
  UNIQUE (legacy_tournament_id, source_snapshot_version, legacy_standing_id)
);

CREATE TABLE engine_legacy_seed_links (
  engine_seed_row_id uuid PRIMARY KEY,
  engine_tournament_id uuid NOT NULL,
  legacy_tournament_id text NOT NULL,
  source_snapshot_version integer NOT NULL,
  legacy_team_id text NOT NULL,
  legacy_seed_key text NOT NULL,
  backfill_run_id uuid NOT NULL
    REFERENCES engine_legacy_backfill_runs(id) ON DELETE RESTRICT,
  FOREIGN KEY (engine_tournament_id, engine_seed_row_id)
    REFERENCES engine_seed_rows(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (legacy_tournament_id, source_snapshot_version, legacy_team_id)
    REFERENCES teams(tournament_id, snapshot_version, team_id)
    ON DELETE RESTRICT,
  UNIQUE (
    legacy_tournament_id, source_snapshot_version, legacy_seed_key
  )
);

CREATE TABLE engine_legacy_bracket_root_links (
  engine_bracket_id uuid PRIMARY KEY,
  engine_tournament_id uuid NOT NULL,
  legacy_tournament_id text NOT NULL,
  source_snapshot_version integer NOT NULL,
  legacy_bracket_id text NOT NULL,
  backfill_run_id uuid NOT NULL
    REFERENCES engine_legacy_backfill_runs(id) ON DELETE RESTRICT,
  FOREIGN KEY (engine_tournament_id, engine_bracket_id)
    REFERENCES engine_brackets(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (legacy_tournament_id, source_snapshot_version)
    REFERENCES tournament_snapshot_versions(tournament_id, version)
    ON DELETE RESTRICT,
  UNIQUE (legacy_tournament_id, source_snapshot_version, legacy_bracket_id)
);

CREATE TABLE engine_legacy_bracket_round_links (
  engine_bracket_round_id uuid PRIMARY KEY,
  engine_tournament_id uuid NOT NULL,
  legacy_tournament_id text NOT NULL,
  source_snapshot_version integer NOT NULL,
  legacy_round_id text NOT NULL,
  backfill_run_id uuid NOT NULL
    REFERENCES engine_legacy_backfill_runs(id) ON DELETE RESTRICT,
  FOREIGN KEY (engine_tournament_id, engine_bracket_round_id)
    REFERENCES engine_bracket_rounds(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (legacy_tournament_id, source_snapshot_version)
    REFERENCES tournament_snapshot_versions(tournament_id, version)
    ON DELETE RESTRICT,
  UNIQUE (legacy_tournament_id, source_snapshot_version, legacy_round_id)
);

CREATE TABLE engine_legacy_bracket_match_links (
  engine_bracket_match_id uuid PRIMARY KEY,
  engine_tournament_id uuid NOT NULL,
  legacy_tournament_id text NOT NULL,
  source_snapshot_version integer NOT NULL,
  legacy_bracket_match_id text NOT NULL,
  backfill_run_id uuid NOT NULL
    REFERENCES engine_legacy_backfill_runs(id) ON DELETE RESTRICT,
  FOREIGN KEY (engine_tournament_id, engine_bracket_match_id)
    REFERENCES engine_bracket_matches(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (legacy_tournament_id, source_snapshot_version)
    REFERENCES tournament_snapshot_versions(tournament_id, version)
    ON DELETE RESTRICT,
  UNIQUE (
    legacy_tournament_id, source_snapshot_version, legacy_bracket_match_id
  )
);

CREATE TABLE engine_legacy_bracket_slot_links (
  engine_bracket_slot_id uuid PRIMARY KEY,
  engine_tournament_id uuid NOT NULL,
  legacy_tournament_id text NOT NULL,
  source_snapshot_version integer NOT NULL,
  legacy_bracket_match_id text NOT NULL,
  legacy_slot_sequence integer NOT NULL,
  legacy_slot_key text NOT NULL,
  backfill_run_id uuid NOT NULL
    REFERENCES engine_legacy_backfill_runs(id) ON DELETE RESTRICT,
  FOREIGN KEY (engine_tournament_id, engine_bracket_slot_id)
    REFERENCES engine_bracket_slots(tournament_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (legacy_tournament_id, source_snapshot_version)
    REFERENCES tournament_snapshot_versions(tournament_id, version)
    ON DELETE RESTRICT,
  CONSTRAINT engine_legacy_bracket_slot_sequence_positive
    CHECK (legacy_slot_sequence > 0),
  UNIQUE (
    legacy_tournament_id, source_snapshot_version, legacy_slot_key
  )
);

CREATE TABLE engine_projection_versions (
  tournament_id uuid NOT NULL
    REFERENCES engine_tournaments(id) ON DELETE RESTRICT,
  version bigint NOT NULL,
  status text NOT NULL,
  payload_schema_version integer NOT NULL,
  source_digest text NOT NULL,
  legacy_projection_tournament_id text,
  legacy_snapshot_version integer,
  created_at timestamptz NOT NULL,
  ready_at timestamptz,
  activated_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tournament_id, version),
  CONSTRAINT engine_projection_versions_version_positive CHECK (version > 0),
  CONSTRAINT engine_projection_versions_payload_version_positive
    CHECK (payload_schema_version > 0),
  CONSTRAINT engine_projection_versions_status_valid
    CHECK (status IN ('building', 'ready', 'active', 'superseded', 'failed')),
  CONSTRAINT engine_projection_versions_digest_valid
    CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT engine_projection_versions_legacy_source_complete CHECK (
    (legacy_projection_tournament_id IS NULL AND legacy_snapshot_version IS NULL)
    OR (
      legacy_projection_tournament_id IS NOT NULL
      AND legacy_snapshot_version IS NOT NULL
    )
  ),
  CONSTRAINT engine_projection_versions_ready_time_consistent CHECK (
    (status = 'building' AND ready_at IS NULL)
    OR (status <> 'building' AND ready_at IS NOT NULL)
  ),
  CONSTRAINT engine_projection_versions_activation_time_consistent CHECK (
    (status = 'active' AND activated_at IS NOT NULL)
    OR (status <> 'active')
  ),
  FOREIGN KEY (legacy_projection_tournament_id, legacy_snapshot_version)
    REFERENCES tournament_snapshot_versions(tournament_id, version)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX engine_projection_versions_single_active_idx
  ON engine_projection_versions (tournament_id)
  WHERE status = 'active';

CREATE TABLE engine_active_projection_versions (
  tournament_id uuid PRIMARY KEY,
  projection_version bigint NOT NULL,
  activated_at timestamptz NOT NULL,
  FOREIGN KEY (tournament_id, projection_version)
    REFERENCES engine_projection_versions(tournament_id, version)
    ON DELETE RESTRICT
);

CREATE FUNCTION engine_reject_public_key_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.public_key IS DISTINCT FROM OLD.public_key THEN
    RAISE EXCEPTION 'Engine public keys are immutable.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_tournaments_public_key_immutable
  BEFORE UPDATE ON engine_tournaments
  FOR EACH ROW EXECUTE FUNCTION engine_reject_public_key_update();

CREATE TRIGGER engine_pods_public_key_immutable
  BEFORE UPDATE ON engine_pods
  FOR EACH ROW EXECUTE FUNCTION engine_reject_public_key_update();

CREATE TRIGGER engine_teams_public_key_immutable
  BEFORE UPDATE ON engine_teams
  FOR EACH ROW EXECUTE FUNCTION engine_reject_public_key_update();

CREATE TRIGGER engine_players_public_key_immutable
  BEFORE UPDATE ON engine_players
  FOR EACH ROW EXECUTE FUNCTION engine_reject_public_key_update();

CREATE TRIGGER engine_roster_memberships_public_key_immutable
  BEFORE UPDATE ON engine_roster_memberships
  FOR EACH ROW EXECUTE FUNCTION engine_reject_public_key_update();

CREATE TRIGGER engine_matches_public_key_immutable
  BEFORE UPDATE ON engine_matches
  FOR EACH ROW EXECUTE FUNCTION engine_reject_public_key_update();

CREATE TRIGGER engine_match_revisions_public_key_immutable
  BEFORE UPDATE ON engine_match_revisions
  FOR EACH ROW EXECUTE FUNCTION engine_reject_public_key_update();

CREATE TRIGGER engine_standing_rows_public_key_immutable
  BEFORE UPDATE ON engine_standing_rows
  FOR EACH ROW EXECUTE FUNCTION engine_reject_public_key_update();

CREATE TRIGGER engine_seed_rows_public_key_immutable
  BEFORE UPDATE ON engine_seed_rows
  FOR EACH ROW EXECUTE FUNCTION engine_reject_public_key_update();

CREATE TRIGGER engine_brackets_public_key_immutable
  BEFORE UPDATE ON engine_brackets
  FOR EACH ROW EXECUTE FUNCTION engine_reject_public_key_update();

CREATE TRIGGER engine_bracket_rounds_public_key_immutable
  BEFORE UPDATE ON engine_bracket_rounds
  FOR EACH ROW EXECUTE FUNCTION engine_reject_public_key_update();

CREATE TRIGGER engine_bracket_matches_public_key_immutable
  BEFORE UPDATE ON engine_bracket_matches
  FOR EACH ROW EXECUTE FUNCTION engine_reject_public_key_update();

CREATE TRIGGER engine_bracket_slots_public_key_immutable
  BEFORE UPDATE ON engine_bracket_slots
  FOR EACH ROW EXECUTE FUNCTION engine_reject_public_key_update();

CREATE FUNCTION engine_reject_locked_setup_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous_tournament_id uuid;
  next_tournament_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    previous_tournament_id := OLD.tournament_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    next_tournament_id := NEW.tournament_id;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM engine_tournaments tournament
    WHERE tournament.id IN (previous_tournament_id, next_tournament_id)
      AND tournament.lifecycle <> 'draft_setup'
  ) THEN
    RAISE EXCEPTION 'Published tournament setup is immutable.'
      USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER engine_configuration_locked_after_publication
  BEFORE INSERT OR UPDATE OR DELETE ON engine_tournament_configurations
  FOR EACH ROW EXECUTE FUNCTION engine_reject_locked_setup_mutation();

CREATE FUNCTION engine_reject_locked_pod_setup_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous_tournament_id uuid;
  next_tournament_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    previous_tournament_id := OLD.tournament_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    next_tournament_id := NEW.tournament_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF EXISTS (
      SELECT 1
      FROM engine_tournaments tournament
      WHERE tournament.id = next_tournament_id
        AND tournament.lifecycle <> 'draft_setup'
    ) THEN
      RAISE EXCEPTION 'Published tournament pod setup is immutable.'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM engine_tournaments tournament
    WHERE tournament.id IN (previous_tournament_id, next_tournament_id)
      AND tournament.lifecycle <> 'draft_setup'
  ) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Published tournament pod setup is immutable.'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.tournament_id IS DISTINCT FROM OLD.tournament_id
      OR NEW.public_key IS DISTINCT FROM OLD.public_key
      OR NEW.name IS DISTINCT FROM OLD.name
      OR NEW.normalized_name IS DISTINCT FROM OLD.normalized_name
      OR NEW.sequence IS DISTINCT FROM OLD.sequence
      OR NEW.metadata IS DISTINCT FROM OLD.metadata
    THEN
      RAISE EXCEPTION 'Published tournament pod setup is immutable.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER engine_pods_locked_after_publication
  BEFORE INSERT OR UPDATE OR DELETE ON engine_pods
  FOR EACH ROW EXECUTE FUNCTION engine_reject_locked_pod_setup_mutation();

CREATE TRIGGER engine_teams_locked_after_publication
  BEFORE INSERT OR UPDATE OR DELETE ON engine_teams
  FOR EACH ROW EXECUTE FUNCTION engine_reject_locked_setup_mutation();

CREATE TRIGGER engine_pod_teams_locked_after_publication
  BEFORE INSERT OR UPDATE OR DELETE ON engine_pod_teams
  FOR EACH ROW EXECUTE FUNCTION engine_reject_locked_setup_mutation();

CREATE FUNCTION engine_reject_frozen_match_slot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous_match_id uuid;
  next_match_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    previous_match_id := OLD.match_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    next_match_id := NEW.match_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM engine_matches match
    WHERE match.id IN (previous_match_id, next_match_id)
      AND match.participants_frozen_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Match participants are frozen after the first scoring revision.'
      USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER engine_match_slots_frozen_after_scoring
  BEFORE INSERT OR UPDATE OR DELETE ON engine_match_slots
  FOR EACH ROW EXECUTE FUNCTION engine_reject_frozen_match_slot_mutation();

CREATE FUNCTION engine_validate_shot_attempt_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM engine_match_events event
    WHERE event.id = NEW.event_id
      AND event.event_type = 'shot_attempt'
  ) THEN
    RAISE EXCEPTION 'Shot attempts must reference a shot_attempt event.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_shot_attempt_event_type_guard
  BEFORE INSERT OR UPDATE ON engine_shot_attempts
  FOR EACH ROW EXECUTE FUNCTION engine_validate_shot_attempt_event();

CREATE FUNCTION engine_validate_shot_classification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM engine_shot_attempts attempt
    WHERE attempt.event_id = NEW.event_id
      AND attempt.outcome = 'miss'
  ) THEN
    RAISE EXCEPTION 'Shot classifications may decorate only a miss attempt.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_shot_classification_miss_guard
  BEFORE INSERT OR UPDATE ON engine_shot_classifications
  FOR EACH ROW EXECUTE FUNCTION engine_validate_shot_classification();

CREATE FUNCTION engine_reject_immutable_artifact_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Canonical history and audit artifacts are immutable.'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER engine_match_revisions_immutable
  BEFORE UPDATE OR DELETE ON engine_match_revisions
  FOR EACH ROW EXECUTE FUNCTION engine_reject_immutable_artifact_mutation();

CREATE TRIGGER engine_match_revision_teams_immutable
  BEFORE UPDATE OR DELETE ON engine_match_revision_teams
  FOR EACH ROW EXECUTE FUNCTION engine_reject_immutable_artifact_mutation();

CREATE TRIGGER engine_match_revision_players_immutable
  BEFORE UPDATE OR DELETE ON engine_match_revision_players
  FOR EACH ROW EXECUTE FUNCTION engine_reject_immutable_artifact_mutation();

CREATE TRIGGER engine_match_events_immutable
  BEFORE UPDATE OR DELETE ON engine_match_events
  FOR EACH ROW EXECUTE FUNCTION engine_reject_immutable_artifact_mutation();

CREATE TRIGGER engine_shot_attempts_immutable
  BEFORE UPDATE OR DELETE ON engine_shot_attempts
  FOR EACH ROW EXECUTE FUNCTION engine_reject_immutable_artifact_mutation();

CREATE TRIGGER engine_shot_classifications_immutable
  BEFORE UPDATE OR DELETE ON engine_shot_classifications
  FOR EACH ROW EXECUTE FUNCTION engine_reject_immutable_artifact_mutation();

CREATE TRIGGER engine_statistic_runs_immutable
  BEFORE UPDATE OR DELETE ON engine_statistic_runs
  FOR EACH ROW EXECUTE FUNCTION engine_reject_immutable_artifact_mutation();

CREATE TRIGGER engine_statistics_immutable
  BEFORE UPDATE OR DELETE ON engine_statistics
  FOR EACH ROW EXECUTE FUNCTION engine_reject_immutable_artifact_mutation();

CREATE TRIGGER engine_standing_calculations_immutable
  BEFORE UPDATE OR DELETE ON engine_standing_calculations
  FOR EACH ROW EXECUTE FUNCTION engine_reject_immutable_artifact_mutation();

CREATE TRIGGER engine_standing_rows_immutable
  BEFORE UPDATE OR DELETE ON engine_standing_rows
  FOR EACH ROW EXECUTE FUNCTION engine_reject_immutable_artifact_mutation();

CREATE TRIGGER engine_pod_finalizations_immutable
  BEFORE UPDATE OR DELETE ON engine_pod_finalizations
  FOR EACH ROW EXECUTE FUNCTION engine_reject_immutable_artifact_mutation();

CREATE TRIGGER engine_seed_calculations_immutable
  BEFORE UPDATE OR DELETE ON engine_seed_calculations
  FOR EACH ROW EXECUTE FUNCTION engine_reject_immutable_artifact_mutation();

CREATE TRIGGER engine_seed_rows_immutable
  BEFORE UPDATE OR DELETE ON engine_seed_rows
  FOR EACH ROW EXECUTE FUNCTION engine_reject_immutable_artifact_mutation();

CREATE TRIGGER engine_seed_overrides_immutable
  BEFORE UPDATE OR DELETE ON engine_seed_overrides
  FOR EACH ROW EXECUTE FUNCTION engine_reject_immutable_artifact_mutation();

CREATE TRIGGER engine_audit_events_immutable
  BEFORE UPDATE OR DELETE ON engine_audit_events
  FOR EACH ROW EXECUTE FUNCTION engine_reject_immutable_artifact_mutation();
