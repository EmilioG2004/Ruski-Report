ALTER TABLE engine_projection_versions
  ADD COLUMN source_tournament_row_version bigint,
  ADD COLUMN source_pointers jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE engine_projection_versions
  ADD CONSTRAINT engine_projection_source_row_version_positive
    CHECK (
      source_tournament_row_version IS NULL
      OR source_tournament_row_version > 0
    ),
  ADD CONSTRAINT engine_projection_source_pointers_object
    CHECK (jsonb_typeof(source_pointers) = 'object');

CREATE TABLE engine_public_tournament_projection_payloads (
  tournament_id uuid NOT NULL,
  projection_version bigint NOT NULL,
  tournament_public_key text NOT NULL,
  visibility text NOT NULL,
  lifecycle text NOT NULL,
  year integer NOT NULL,
  tournament_summary jsonb NOT NULL,
  tournament_detail jsonb NOT NULL,
  tournament_summary_digest text NOT NULL,
  tournament_detail_digest text NOT NULL,
  match_count integer NOT NULL,
  source_tournament_row_version bigint NOT NULL,
  source_pointers jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tournament_id, projection_version),
  FOREIGN KEY (tournament_id, projection_version)
    REFERENCES engine_projection_versions(tournament_id, version)
    ON DELETE RESTRICT,
  CONSTRAINT engine_public_tournament_key_nonempty
    CHECK (length(btrim(tournament_public_key)) > 0),
  CONSTRAINT engine_public_tournament_visibility_valid
    CHECK (visibility IN ('private', 'public')),
  CONSTRAINT engine_public_tournament_lifecycle_valid CHECK (
    lifecycle IN (
      'draft_setup', 'setup_published', 'pod_play', 'seeding_review',
      'playoffs', 'completed', 'archived'
    )
  ),
  CONSTRAINT engine_public_tournament_year_positive CHECK (year > 0),
  CONSTRAINT engine_public_tournament_summary_object
    CHECK (jsonb_typeof(tournament_summary) = 'object'),
  CONSTRAINT engine_public_tournament_detail_object
    CHECK (jsonb_typeof(tournament_detail) = 'object'),
  CONSTRAINT engine_public_tournament_digests_valid CHECK (
    tournament_summary_digest ~ '^[a-f0-9]{64}$'
    AND tournament_detail_digest ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT engine_public_tournament_match_count_nonnegative
    CHECK (match_count >= 0),
  CONSTRAINT engine_public_tournament_source_version_positive
    CHECK (source_tournament_row_version > 0),
  CONSTRAINT engine_public_tournament_source_pointers_object
    CHECK (jsonb_typeof(source_pointers) = 'object'),
  UNIQUE (tournament_public_key, projection_version)
);

CREATE INDEX engine_public_tournament_discovery_idx
  ON engine_public_tournament_projection_payloads (
    visibility, lifecycle, year DESC, tournament_public_key
  );

CREATE TABLE engine_public_match_projection_payloads (
  tournament_id uuid NOT NULL,
  projection_version bigint NOT NULL,
  match_id uuid NOT NULL,
  match_public_key text NOT NULL,
  summary_payload jsonb NOT NULL,
  detail_payload jsonb NOT NULL,
  summary_digest text NOT NULL,
  detail_digest text NOT NULL,
  source_match_row_version bigint NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (tournament_id, projection_version, match_id),
  FOREIGN KEY (tournament_id, projection_version)
    REFERENCES engine_public_tournament_projection_payloads(
      tournament_id, projection_version
    ) ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, match_id)
    REFERENCES engine_matches(tournament_id, id) ON DELETE RESTRICT,
  CONSTRAINT engine_public_match_key_nonempty
    CHECK (length(btrim(match_public_key)) > 0),
  CONSTRAINT engine_public_match_summary_object
    CHECK (jsonb_typeof(summary_payload) = 'object'),
  CONSTRAINT engine_public_match_detail_object
    CHECK (jsonb_typeof(detail_payload) = 'object'),
  CONSTRAINT engine_public_match_digests_valid CHECK (
    summary_digest ~ '^[a-f0-9]{64}$'
    AND detail_digest ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT engine_public_match_source_version_positive
    CHECK (source_match_row_version > 0),
  UNIQUE (tournament_id, projection_version, match_public_key)
);

CREATE INDEX engine_public_match_lookup_idx
  ON engine_public_match_projection_payloads (
    match_public_key, tournament_id, projection_version
  );

CREATE TABLE engine_public_projection_activations (
  audit_event_id uuid PRIMARY KEY
    REFERENCES engine_audit_events(id) ON DELETE RESTRICT,
  tournament_id uuid NOT NULL
    REFERENCES engine_tournaments(id) ON DELETE RESTRICT,
  previous_projection_version bigint,
  projection_version bigint NOT NULL,
  action text NOT NULL,
  reason text,
  activated_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tournament_id, projection_version)
    REFERENCES engine_projection_versions(tournament_id, version)
    ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id, previous_projection_version)
    REFERENCES engine_projection_versions(tournament_id, version)
    ON DELETE RESTRICT,
  CONSTRAINT engine_public_projection_activation_action_valid
    CHECK (action IN ('activate', 'reactivate', 'rollback')),
  CONSTRAINT engine_public_projection_activation_versions_distinct
    CHECK (
      previous_projection_version IS NULL
      OR previous_projection_version <> projection_version
    ),
  CONSTRAINT engine_public_projection_activation_reason_consistent CHECK (
    (action = 'activate' AND reason IS NULL)
    OR (action IN ('reactivate', 'rollback') AND length(btrim(reason)) > 0)
  ),
  CONSTRAINT engine_public_projection_activation_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX engine_public_projection_activation_history_idx
  ON engine_public_projection_activations (
    tournament_id, activated_at DESC, audit_event_id
  );

CREATE FUNCTION engine_guard_projection_version_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tournament_id IS DISTINCT FROM OLD.tournament_id
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.payload_schema_version IS DISTINCT FROM OLD.payload_schema_version
    OR NEW.source_digest IS DISTINCT FROM OLD.source_digest
    OR NEW.legacy_projection_tournament_id IS DISTINCT FROM
      OLD.legacy_projection_tournament_id
    OR NEW.legacy_snapshot_version IS DISTINCT FROM OLD.legacy_snapshot_version
    OR NEW.source_tournament_row_version IS DISTINCT FROM
      OLD.source_tournament_row_version
    OR NEW.source_pointers IS DISTINCT FROM OLD.source_pointers
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.metadata IS DISTINCT FROM OLD.metadata
  THEN
    RAISE EXCEPTION 'Public projection source headers are immutable.'
      USING ERRCODE = '23514';
  END IF;

  IF (OLD.status, NEW.status) NOT IN (
    ('building', 'ready'),
    ('building', 'failed'),
    ('ready', 'active'),
    ('ready', 'failed'),
    ('active', 'superseded'),
    ('superseded', 'active')
  ) THEN
    RAISE EXCEPTION 'Public projection status transition is invalid.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'building' THEN
    IF OLD.ready_at IS NOT NULL OR NEW.ready_at IS NULL THEN
      RAISE EXCEPTION 'Completing a projection build must set ready_at once.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.ready_at IS DISTINCT FROM OLD.ready_at THEN
    RAISE EXCEPTION 'Public projection ready_at is immutable after build.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'active' THEN
    IF NEW.activated_at IS NULL OR NEW.activated_at IS NOT DISTINCT FROM
      OLD.activated_at
    THEN
      RAISE EXCEPTION 'Projection activation must record a new activated_at.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
    RAISE EXCEPTION 'Only projection activation may change activated_at.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_projection_versions_update_guard
  BEFORE UPDATE ON engine_projection_versions
  FOR EACH ROW EXECUTE FUNCTION engine_guard_projection_version_update();

CREATE FUNCTION engine_reject_public_projection_payload_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Materialized public projection payloads are immutable.'
    USING ERRCODE = '23514';
END;
$$;

CREATE FUNCTION engine_require_building_public_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM engine_projection_versions projection
    WHERE projection.tournament_id = NEW.tournament_id
      AND projection.version = NEW.projection_version
      AND projection.status = 'building'
  ) THEN
    RAISE EXCEPTION 'Public projection payloads may be inserted only while building.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_public_tournament_payloads_building_guard
  BEFORE INSERT ON engine_public_tournament_projection_payloads
  FOR EACH ROW EXECUTE FUNCTION engine_require_building_public_projection();

CREATE TRIGGER engine_public_match_payloads_building_guard
  BEFORE INSERT ON engine_public_match_projection_payloads
  FOR EACH ROW EXECUTE FUNCTION engine_require_building_public_projection();

CREATE TRIGGER engine_public_tournament_payloads_immutable
  BEFORE UPDATE OR DELETE ON engine_public_tournament_projection_payloads
  FOR EACH ROW EXECUTE FUNCTION engine_reject_public_projection_payload_mutation();

CREATE TRIGGER engine_public_match_payloads_immutable
  BEFORE UPDATE OR DELETE ON engine_public_match_projection_payloads
  FOR EACH ROW EXECUTE FUNCTION engine_reject_public_projection_payload_mutation();

CREATE FUNCTION engine_validate_active_public_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  checked_tournament_id uuid;
  checked_projection_version bigint;
BEGIN
  checked_tournament_id := NEW.tournament_id;
  IF TG_TABLE_NAME = 'engine_projection_versions' THEN
    checked_projection_version := NEW.version;
  ELSE
    checked_projection_version := NEW.projection_version;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM engine_active_projection_versions active
    WHERE active.tournament_id = checked_tournament_id
      AND active.projection_version = checked_projection_version
  ) AND NOT EXISTS (
    SELECT 1
    FROM engine_projection_versions projection
    LEFT JOIN engine_public_tournament_projection_payloads payload
      ON payload.tournament_id = projection.tournament_id
     AND payload.projection_version = projection.version
    WHERE projection.tournament_id = checked_tournament_id
      AND projection.version = checked_projection_version
      AND projection.status = 'active'
      AND (
        projection.payload_schema_version < 2
        OR (
          payload.tournament_id IS NOT NULL
          AND projection.source_tournament_row_version =
            payload.source_tournament_row_version
          AND projection.source_pointers = payload.source_pointers
          AND projection.activated_at = (
            SELECT active.activated_at
            FROM engine_active_projection_versions active
            WHERE active.tournament_id = projection.tournament_id
              AND active.projection_version = projection.version
          )
          AND payload.match_count = (
            SELECT count(*)
            FROM engine_public_match_projection_payloads match_payload
            WHERE match_payload.tournament_id = payload.tournament_id
              AND match_payload.projection_version = payload.projection_version
          )
          AND EXISTS (
            SELECT 1
            FROM engine_public_projection_activations activation
            WHERE activation.tournament_id = projection.tournament_id
              AND activation.projection_version = projection.version
              AND activation.activated_at = projection.activated_at
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Active public projection must be active and materialized.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER engine_active_public_projection_pointer_guard
  AFTER INSERT OR UPDATE ON engine_active_projection_versions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION engine_validate_active_public_projection();

CREATE CONSTRAINT TRIGGER engine_active_public_projection_status_guard
  AFTER UPDATE OF status ON engine_projection_versions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION engine_validate_active_public_projection();

CREATE TRIGGER engine_public_projection_activations_immutable
  BEFORE UPDATE OR DELETE ON engine_public_projection_activations
  FOR EACH ROW EXECUTE FUNCTION engine_reject_public_projection_payload_mutation();
