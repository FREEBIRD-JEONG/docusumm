CREATE TABLE IF NOT EXISTS summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL,
  source_type text NOT NULL CHECK (source_type IN ('text', 'youtube')),
  original_content text NOT NULL,
  summary_text text NULL,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS summary_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_id uuid NOT NULL REFERENCES summaries(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  attempt_count int NOT NULL DEFAULT 0,
  scheduled_at timestamptz NOT NULL DEFAULT NOW(),
  locked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_summary_jobs_queue
  ON summary_jobs (status, scheduled_at, created_at);
