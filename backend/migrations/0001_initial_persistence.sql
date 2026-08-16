CREATE TABLE tournaments (
  id text PRIMARY KEY,
  game_type text NOT NULL,
  year integer NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournaments_year_positive CHECK (year > 0)
);

CREATE INDEX tournaments_active_lookup_idx
  ON tournaments (game_type, year DESC);

CREATE TABLE scorebook_sources (
  id text PRIMARY KEY,
  original_name text NOT NULL,
  mime_type text,
  size_bytes bigint,
  checksum text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scorebook_sources_size_nonnegative
    CHECK (size_bytes IS NULL OR size_bytes >= 0)
);

CREATE TABLE tournament_snapshot_versions (
  tournament_id text NOT NULL REFERENCES tournaments(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  status text NOT NULL,
  format jsonb NOT NULL,
  active_match_ids text[] NOT NULL DEFAULT '{}',
  featured_match_ids text[] NOT NULL DEFAULT '{}',
  bracket jsonb,
  statistics jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  game_definition jsonb NOT NULL,
  validation jsonb NOT NULL,
  source_id text NOT NULL REFERENCES scorebook_sources(id) ON DELETE RESTRICT,
  generated_at timestamptz NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tournament_id, version),
  CONSTRAINT tournament_snapshot_versions_version_positive CHECK (version > 0),
  CONSTRAINT tournament_snapshot_versions_status_valid
    CHECK (status IN ('scheduled', 'active', 'completed', 'archived'))
);

CREATE TABLE active_tournament_snapshots (
  tournament_id text PRIMARY KEY,
  snapshot_version integer NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tournament_id, snapshot_version)
    REFERENCES tournament_snapshot_versions(tournament_id, version)
    ON DELETE RESTRICT
);

CREATE TABLE teams (
  tournament_id text NOT NULL,
  snapshot_version integer NOT NULL,
  team_id text NOT NULL,
  name text NOT NULL,
  sequence integer NOT NULL,
  seed jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tournament_id, snapshot_version, team_id),
  FOREIGN KEY (tournament_id, snapshot_version)
    REFERENCES tournament_snapshot_versions(tournament_id, version)
    ON DELETE CASCADE,
  CONSTRAINT teams_sequence_positive CHECK (sequence > 0)
);

CREATE TABLE players (
  tournament_id text NOT NULL,
  snapshot_version integer NOT NULL,
  player_id text NOT NULL,
  display_name text NOT NULL,
  first_name text,
  last_name text,
  preferred_name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tournament_id, snapshot_version, player_id),
  FOREIGN KEY (tournament_id, snapshot_version)
    REFERENCES tournament_snapshot_versions(tournament_id, version)
    ON DELETE CASCADE
);

CREATE TABLE team_players (
  tournament_id text NOT NULL,
  snapshot_version integer NOT NULL,
  team_id text NOT NULL,
  player_id text NOT NULL,
  sequence integer NOT NULL,
  PRIMARY KEY (tournament_id, snapshot_version, team_id, player_id),
  FOREIGN KEY (tournament_id, snapshot_version, team_id)
    REFERENCES teams(tournament_id, snapshot_version, team_id)
    ON DELETE CASCADE,
  FOREIGN KEY (tournament_id, snapshot_version, player_id)
    REFERENCES players(tournament_id, snapshot_version, player_id)
    ON DELETE CASCADE,
  CONSTRAINT team_players_sequence_positive CHECK (sequence > 0)
);

CREATE TABLE match_identities (
  match_id text PRIMARY KEY,
  tournament_id text NOT NULL REFERENCES tournaments(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE matches (
  tournament_id text NOT NULL,
  snapshot_version integer NOT NULL,
  match_id text NOT NULL REFERENCES match_identities(match_id) ON DELETE RESTRICT,
  sequence integer NOT NULL,
  game_type text NOT NULL,
  status text NOT NULL,
  participants jsonb NOT NULL,
  score jsonb NOT NULL,
  pod_id text,
  bracket_match_id text,
  current_phase jsonb,
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  box_score jsonb NOT NULL,
  scorecard jsonb NOT NULL,
  events jsonb NOT NULL,
  comments_summary jsonb,
  domain_version integer NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tournament_id, snapshot_version, match_id),
  FOREIGN KEY (tournament_id, snapshot_version)
    REFERENCES tournament_snapshot_versions(tournament_id, version)
    ON DELETE CASCADE,
  CONSTRAINT matches_sequence_positive CHECK (sequence > 0),
  CONSTRAINT matches_domain_version_positive CHECK (domain_version > 0)
);

CREATE INDEX matches_active_lookup_idx ON matches (match_id);
CREATE INDEX matches_tournament_lookup_idx
  ON matches (tournament_id, snapshot_version);

CREATE TABLE pods (
  tournament_id text NOT NULL,
  snapshot_version integer NOT NULL,
  pod_id text NOT NULL,
  name text NOT NULL,
  sequence integer NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tournament_id, snapshot_version, pod_id),
  FOREIGN KEY (tournament_id, snapshot_version)
    REFERENCES tournament_snapshot_versions(tournament_id, version)
    ON DELETE CASCADE,
  CONSTRAINT pods_sequence_positive CHECK (sequence > 0)
);

CREATE TABLE pod_teams (
  tournament_id text NOT NULL,
  snapshot_version integer NOT NULL,
  pod_id text NOT NULL,
  team_id text NOT NULL,
  sequence integer NOT NULL,
  PRIMARY KEY (tournament_id, snapshot_version, pod_id, team_id),
  FOREIGN KEY (tournament_id, snapshot_version, pod_id)
    REFERENCES pods(tournament_id, snapshot_version, pod_id)
    ON DELETE CASCADE,
  FOREIGN KEY (tournament_id, snapshot_version, team_id)
    REFERENCES teams(tournament_id, snapshot_version, team_id)
    ON DELETE CASCADE
);

CREATE TABLE pod_matches (
  tournament_id text NOT NULL,
  snapshot_version integer NOT NULL,
  pod_id text NOT NULL,
  match_id text NOT NULL,
  sequence integer NOT NULL,
  PRIMARY KEY (tournament_id, snapshot_version, pod_id, match_id),
  FOREIGN KEY (tournament_id, snapshot_version, pod_id)
    REFERENCES pods(tournament_id, snapshot_version, pod_id)
    ON DELETE CASCADE,
  FOREIGN KEY (tournament_id, snapshot_version, match_id)
    REFERENCES matches(tournament_id, snapshot_version, match_id)
    ON DELETE CASCADE
);

CREATE TABLE standings (
  tournament_id text NOT NULL,
  snapshot_version integer NOT NULL,
  standing_id text NOT NULL,
  scope text NOT NULL,
  team_id text NOT NULL,
  pod_id text,
  rank integer NOT NULL,
  record jsonb NOT NULL,
  games_played integer NOT NULL,
  points integer,
  metric_values jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tournament_id, snapshot_version, standing_id),
  FOREIGN KEY (tournament_id, snapshot_version, team_id)
    REFERENCES teams(tournament_id, snapshot_version, team_id)
    ON DELETE CASCADE,
  FOREIGN KEY (tournament_id, snapshot_version, pod_id)
    REFERENCES pods(tournament_id, snapshot_version, pod_id)
    ON DELETE CASCADE,
  CONSTRAINT standings_scope_valid CHECK (scope IN ('pod', 'tournament')),
  CONSTRAINT standings_rank_positive CHECK (rank > 0),
  CONSTRAINT standings_games_nonnegative CHECK (games_played >= 0)
);

CREATE TABLE comments (
  id text PRIMARY KEY,
  match_id text NOT NULL REFERENCES match_identities(match_id) ON DELETE RESTRICT,
  author_kind text NOT NULL,
  author_display_name text NOT NULL,
  author_user_id text,
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz,
  deleted_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT comments_author_kind_valid
    CHECK (author_kind IN ('guest', 'account', 'admin', 'system')),
  CONSTRAINT comments_body_nonempty CHECK (length(body) > 0)
);

CREATE INDEX comments_match_created_idx
  ON comments (match_id, created_at) WHERE deleted_at IS NULL;

CREATE TABLE upload_reports (
  id text PRIMARY KEY,
  game_type text NOT NULL,
  source_id text NOT NULL REFERENCES scorebook_sources(id) ON DELETE RESTRICT,
  status text NOT NULL,
  validation jsonb NOT NULL,
  tournament_id text,
  snapshot_version integer,
  snapshot_published_at timestamptz,
  previous_snapshot_version integer,
  received_at timestamptz NOT NULL,
  completed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT upload_reports_status_valid CHECK (
    status IN ('received', 'validation_failed', 'publish_failed', 'published')
  ),
  CONSTRAINT upload_reports_snapshot_complete CHECK (
    (snapshot_version IS NULL AND snapshot_published_at IS NULL)
    OR (snapshot_version IS NOT NULL AND snapshot_published_at IS NOT NULL)
  )
);

CREATE INDEX upload_reports_received_idx ON upload_reports (received_at DESC);
