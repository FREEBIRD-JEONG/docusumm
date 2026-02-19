CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  credits int NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'summaries_user_id_users_id_fk'
  ) THEN
    ALTER TABLE summaries
      ADD CONSTRAINT summaries_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_summaries_user_created_at
  ON summaries (user_id, created_at DESC);
