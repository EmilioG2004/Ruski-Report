CREATE TABLE admin_accounts (
  id uuid PRIMARY KEY,
  login_name text NOT NULL,
  normalized_login_name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  credential_version integer NOT NULL DEFAULT 1,
  created_by_admin_id uuid REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_authenticated_at timestamptz,
  CONSTRAINT admin_accounts_login_name_valid
    CHECK (login_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'),
  CONSTRAINT admin_accounts_normalized_login_name_valid
    CHECK (normalized_login_name ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  CONSTRAINT admin_accounts_display_name_nonempty
    CHECK (length(btrim(display_name)) > 0 AND char_length(display_name) <= 80),
  CONSTRAINT admin_accounts_status_valid
    CHECK (status IN ('active', 'disabled')),
  CONSTRAINT admin_accounts_credential_version_positive
    CHECK (credential_version > 0)
);

CREATE TABLE admin_account_credentials (
  administrator_id uuid PRIMARY KEY
    REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  hash_algorithm text NOT NULL,
  hash_version smallint NOT NULL,
  password_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_credentials_algorithm_nonempty
    CHECK (length(btrim(hash_algorithm)) > 0),
  CONSTRAINT admin_credentials_hash_version_positive CHECK (hash_version > 0),
  CONSTRAINT admin_credentials_password_hash_nonempty
    CHECK (length(password_hash) > 0)
);

CREATE TABLE admin_sessions (
  id uuid PRIMARY KEY,
  administrator_id uuid NOT NULL
    REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  csrf_token_hash text NOT NULL,
  authenticated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text,
  CONSTRAINT admin_sessions_token_hash_valid
    CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT admin_sessions_csrf_hash_valid
    CHECK (csrf_token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT admin_sessions_expiration_valid CHECK (
    authenticated_at <= created_at
    AND created_at <= last_seen_at
    AND last_seen_at < expires_at
    AND idle_expires_at <= expires_at
    AND created_at < idle_expires_at
  ),
  CONSTRAINT admin_sessions_revocation_consistent CHECK (
    (revoked_at IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  )
);

CREATE INDEX admin_sessions_account_active_idx
  ON admin_sessions (administrator_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX admin_sessions_token_active_idx
  ON admin_sessions (token_hash)
  WHERE revoked_at IS NULL;

CREATE TABLE admin_invitations (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  login_name text NOT NULL,
  normalized_login_name text NOT NULL,
  display_name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  invited_by_admin_id uuid REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by_admin_id uuid REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  CONSTRAINT admin_invitations_kind_valid
    CHECK (kind IN ('standard', 'bootstrap')),
  CONSTRAINT admin_invitations_login_name_valid
    CHECK (login_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'),
  CONSTRAINT admin_invitations_normalized_login_name_valid
    CHECK (normalized_login_name ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  CONSTRAINT admin_invitations_display_name_nonempty
    CHECK (length(btrim(display_name)) > 0 AND char_length(display_name) <= 80),
  CONSTRAINT admin_invitations_token_hash_valid
    CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT admin_invitations_expiration_valid CHECK (expires_at > created_at),
  CONSTRAINT admin_invitations_issuer_consistent CHECK (
    (kind = 'bootstrap' AND invited_by_admin_id IS NULL)
    OR (kind = 'standard' AND invited_by_admin_id IS NOT NULL)
  ),
  CONSTRAINT admin_invitations_completion_consistent CHECK (
    (accepted_at IS NULL AND accepted_by_admin_id IS NULL)
    OR (accepted_at IS NOT NULL AND accepted_by_admin_id IS NOT NULL)
  ),
  CONSTRAINT admin_invitations_terminal_state_unique
    CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX admin_invitations_pending_login_idx
  ON admin_invitations (normalized_login_name, expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE UNIQUE INDEX admin_invitations_single_pending_login_idx
  ON admin_invitations (normalized_login_name)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE admin_recovery_tokens (
  id uuid PRIMARY KEY,
  administrator_id uuid NOT NULL
    REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE,
  issued_by_admin_id uuid REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  issued_via text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT admin_recovery_tokens_hash_valid
    CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT admin_recovery_tokens_issued_via_valid
    CHECK (issued_via IN ('administrator', 'local_operator')),
  CONSTRAINT admin_recovery_tokens_issuer_consistent CHECK (
    (issued_via = 'administrator' AND issued_by_admin_id IS NOT NULL)
    OR (issued_via = 'local_operator' AND issued_by_admin_id IS NULL)
  ),
  CONSTRAINT admin_recovery_tokens_expiration_valid CHECK (expires_at > created_at),
  CONSTRAINT admin_recovery_tokens_terminal_state_unique
    CHECK (consumed_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX admin_recovery_tokens_account_pending_idx
  ON admin_recovery_tokens (administrator_id, expires_at)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE UNIQUE INDEX admin_recovery_tokens_single_pending_account_idx
  ON admin_recovery_tokens (administrator_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE admin_rate_limit_buckets (
  scope text NOT NULL,
  subject_hash text NOT NULL,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL,
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, subject_hash),
  CONSTRAINT admin_rate_limit_scope_nonempty CHECK (length(btrim(scope)) > 0),
  CONSTRAINT admin_rate_limit_subject_hash_valid
    CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT admin_rate_limit_attempt_count_positive CHECK (attempt_count > 0),
  CONSTRAINT admin_rate_limit_block_valid
    CHECK (blocked_until IS NULL OR blocked_until > window_started_at)
);

CREATE INDEX admin_rate_limit_cleanup_idx
  ON admin_rate_limit_buckets (updated_at);

CREATE TABLE admin_security_audit_events (
  id uuid PRIMARY KEY,
  administrator_id uuid REFERENCES admin_accounts(id) ON DELETE RESTRICT,
  session_id uuid REFERENCES admin_sessions(id) ON DELETE SET NULL,
  legacy_operator_id text,
  event_type text NOT NULL,
  outcome text NOT NULL,
  reason_code text,
  target_type text,
  target_id text,
  request_id text,
  correlation_id uuid,
  network_key_hash text,
  user_agent_hash text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT admin_security_audit_event_type_nonempty
    CHECK (length(btrim(event_type)) > 0),
  CONSTRAINT admin_security_audit_outcome_valid
    CHECK (outcome IN ('accepted', 'rejected')),
  CONSTRAINT admin_security_audit_network_hash_valid
    CHECK (network_key_hash IS NULL OR network_key_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT admin_security_audit_user_agent_hash_valid
    CHECK (user_agent_hash IS NULL OR user_agent_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT admin_security_audit_actor_consistent CHECK (
    NOT (administrator_id IS NOT NULL AND legacy_operator_id IS NOT NULL)
    AND (session_id IS NULL OR administrator_id IS NOT NULL)
  )
);

CREATE INDEX admin_security_audit_time_idx
  ON admin_security_audit_events (occurred_at DESC, id);

CREATE INDEX admin_security_audit_actor_idx
  ON admin_security_audit_events (administrator_id, occurred_at DESC, id)
  WHERE administrator_id IS NOT NULL;

CREATE FUNCTION admin_reject_security_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Administrator security audit events are immutable.'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER admin_security_audit_events_immutable
  BEFORE UPDATE OR DELETE ON admin_security_audit_events
  FOR EACH ROW EXECUTE FUNCTION admin_reject_security_audit_mutation();

CREATE FUNCTION engine_reject_published_player_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous_tournament_id uuid;
  next_tournament_id uuid;
BEGIN
  previous_tournament_id := OLD.tournament_id;
  IF TG_OP = 'UPDATE' THEN
    next_tournament_id := NEW.tournament_id;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM engine_tournaments tournament
    WHERE tournament.id IN (previous_tournament_id, next_tournament_id)
      AND tournament.lifecycle <> 'draft_setup'
  ) THEN
    RAISE EXCEPTION 'Published tournament player history is immutable.'
      USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER engine_players_locked_after_publication
  BEFORE UPDATE OR DELETE ON engine_players
  FOR EACH ROW EXECUTE FUNCTION engine_reject_published_player_mutation();

CREATE FUNCTION engine_guard_published_roster_membership_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM engine_tournaments tournament
    WHERE tournament.id = NEW.tournament_id
      AND tournament.lifecycle <> 'draft_setup'
  ) THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM engine_tournament_configurations configuration
    WHERE configuration.tournament_id = NEW.tournament_id
      AND NEW.roster_slot <= configuration.players_per_team
  ) THEN
    RAISE EXCEPTION 'Published roster replacement slot exceeds the copied configuration.'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM engine_roster_memberships prior
    WHERE prior.tournament_id = NEW.tournament_id
      AND prior.team_id = NEW.team_id
      AND prior.roster_slot = NEW.roster_slot
      AND prior.closed_at IS NOT NULL
      AND prior.closed_at <= NEW.opened_at
  ) THEN
    RAISE EXCEPTION 'Published roster insertion requires closed prior membership history.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_roster_memberships_insert_guard_after_publication
  BEFORE INSERT ON engine_roster_memberships
  FOR EACH ROW EXECUTE FUNCTION engine_guard_published_roster_membership_insert();

CREATE FUNCTION engine_guard_published_roster_membership_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous_tournament_id uuid;
  next_tournament_id uuid;
BEGIN
  previous_tournament_id := OLD.tournament_id;
  IF TG_OP = 'UPDATE' THEN
    next_tournament_id := NEW.tournament_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM engine_tournaments tournament
    WHERE tournament.id IN (previous_tournament_id, next_tournament_id)
      AND tournament.lifecycle <> 'draft_setup'
  ) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Published tournament roster history cannot be deleted.'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.closed_at IS NOT NULL
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.tournament_id IS DISTINCT FROM OLD.tournament_id
    OR NEW.public_key IS DISTINCT FROM OLD.public_key
    OR NEW.team_id IS DISTINCT FROM OLD.team_id
    OR NEW.player_id IS DISTINCT FROM OLD.player_id
    OR NEW.roster_slot IS DISTINCT FROM OLD.roster_slot
    OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
    OR NEW.opened_by IS DISTINCT FROM OLD.opened_by
    OR NEW.metadata IS DISTINCT FROM OLD.metadata
    OR NEW.closed_at IS NULL
    OR NEW.closed_by IS NULL
    OR length(btrim(NEW.closed_by)) = 0
    OR NEW.replacement_reason IS NULL
    OR length(btrim(NEW.replacement_reason)) = 0
  THEN
    RAISE EXCEPTION 'Published roster membership may only transition once from open to closed.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER engine_roster_memberships_guard_after_publication
  BEFORE UPDATE OR DELETE ON engine_roster_memberships
  FOR EACH ROW EXECUTE FUNCTION engine_guard_published_roster_membership_mutation();
