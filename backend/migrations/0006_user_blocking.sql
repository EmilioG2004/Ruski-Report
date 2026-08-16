CREATE TABLE user_blocks (
  blocker_user_id text NOT NULL
    REFERENCES user_accounts(id) ON DELETE CASCADE,
  blocked_user_id text NOT NULL
    REFERENCES user_accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (blocker_user_id, blocked_user_id),
  CONSTRAINT user_blocks_distinct_accounts
    CHECK (blocker_user_id <> blocked_user_id)
);

CREATE INDEX user_blocks_list_idx
  ON user_blocks (blocker_user_id, created_at DESC, blocked_user_id);

CREATE INDEX user_blocks_blocked_user_idx
  ON user_blocks (blocked_user_id);
