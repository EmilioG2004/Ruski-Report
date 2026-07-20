CREATE TABLE user_accounts (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  normalized_display_name text NOT NULL UNIQUE,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_accounts_provider_valid
    CHECK (provider IN ('local_account', 'game_center', 'tau_id')),
  CONSTRAINT user_accounts_status_valid
    CHECK (status IN ('active', 'disabled')),
  CONSTRAINT user_accounts_display_name_nonempty
    CHECK (length(display_name) > 0)
);

CREATE TABLE local_account_credentials (
  user_id text PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE external_identities (
  user_id text NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_subject text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_subject),
  CONSTRAINT external_identities_provider_valid
    CHECK (provider IN ('game_center', 'tau_id'))
);

CREATE INDEX external_identities_user_idx ON external_identities (user_id);

CREATE TABLE auth_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_sessions_expiration_valid CHECK (expires_at > created_at)
);

CREATE INDEX auth_sessions_user_active_idx
  ON auth_sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX auth_sessions_token_active_idx
  ON auth_sessions (token_hash)
  WHERE revoked_at IS NULL;

UPDATE comments
SET author_user_id = NULL
WHERE author_user_id IS NOT NULL;

ALTER TABLE comments
  ADD CONSTRAINT comments_author_user_fk
  FOREIGN KEY (author_user_id) REFERENCES user_accounts(id) ON DELETE SET NULL;
