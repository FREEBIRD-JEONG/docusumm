CREATE TABLE IF NOT EXISTS credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount int NOT NULL,
  type text NOT NULL,
  source text NOT NULL,
  package_id text,
  stripe_event_id text,
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_created_at
  ON credit_transactions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  processed_at timestamptz NOT NULL DEFAULT NOW()
);
