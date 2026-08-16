CREATE TABLE comment_reports (
  id text PRIMARY KEY,
  comment_id text REFERENCES comments(id) ON DELETE SET NULL,
  reported_comment_id text NOT NULL,
  match_id text NOT NULL REFERENCES match_identities(match_id) ON DELETE RESTRICT,
  reporter_user_id text REFERENCES user_accounts(id) ON DELETE SET NULL,
  reason text NOT NULL,
  context text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL,
  reviewed_at timestamptz,
  resolved_at timestamptz,
  resolution text,
  moderator_id text,
  resolution_note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT comment_reports_reason_valid CHECK (
    reason IN (
      'harassment',
      'hate_or_discrimination',
      'threat_or_self_harm',
      'sexual_content',
      'spam',
      'other'
    )
  ),
  CONSTRAINT comment_reports_context_length CHECK (
    context IS NULL OR char_length(context) <= 2000
  ),
  CONSTRAINT comment_reports_resolution_note_length CHECK (
    resolution_note IS NULL OR char_length(resolution_note) <= 2000
  ),
  CONSTRAINT comment_reports_status_valid CHECK (
    status IN ('open', 'reviewed', 'resolved')
  ),
  CONSTRAINT comment_reports_resolution_valid CHECK (
    resolution IS NULL OR resolution IN ('dismissed', 'comment_removed')
  ),
  CONSTRAINT comment_reports_state_consistent CHECK (
    (
      status = 'open'
      AND reviewed_at IS NULL
      AND resolved_at IS NULL
      AND resolution IS NULL
      AND moderator_id IS NULL
    )
    OR (
      status = 'reviewed'
      AND reviewed_at IS NOT NULL
      AND resolved_at IS NULL
      AND resolution IS NULL
      AND moderator_id IS NOT NULL
    )
    OR (
      status = 'resolved'
      AND resolved_at IS NOT NULL
      AND resolution IS NOT NULL
      AND moderator_id IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX comment_reports_reporter_comment_unique_idx
  ON comment_reports (reported_comment_id, reporter_user_id)
  WHERE reporter_user_id IS NOT NULL;

CREATE INDEX comment_reports_queue_idx
  ON comment_reports (status, created_at, id);

CREATE INDEX comment_reports_rate_limit_idx
  ON comment_reports (reporter_user_id, created_at DESC)
  WHERE reporter_user_id IS NOT NULL;
