ALTER TABLE comments
  ADD COLUMN normalized_body_hash text;

ALTER TABLE comments
  ADD CONSTRAINT comments_normalized_body_hash_valid
  CHECK (
    normalized_body_hash IS NULL
    OR normalized_body_hash ~ '^[a-f0-9]{64}$'
  );

CREATE INDEX comments_recent_submission_idx
  ON comments (
    match_id,
    author_user_id,
    normalized_body_hash,
    created_at DESC
  )
  WHERE deleted_at IS NULL AND normalized_body_hash IS NOT NULL;
