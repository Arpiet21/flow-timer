-- ── Tasks table ──────────────────────────────────────────────────────────────
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS tasks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title             text NOT NULL,
  category          text NOT NULL DEFAULT 'Personal',
  estimated_minutes int  NOT NULL DEFAULT 25,
  priority          int  NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  tags              text[] DEFAULT '{}',
  completed         boolean NOT NULL DEFAULT false,
  completed_at      timestamptz,
  created_at        timestamptz DEFAULT now()
);

-- Index for fast per-user queries
CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks(user_id);

-- Enable RLS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own tasks"
  ON tasks FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
