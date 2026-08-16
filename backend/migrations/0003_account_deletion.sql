ALTER TABLE comments
  DROP CONSTRAINT comments_author_user_fk;

ALTER TABLE comments
  ADD CONSTRAINT comments_author_user_fk
  FOREIGN KEY (author_user_id) REFERENCES user_accounts(id) ON DELETE CASCADE;
