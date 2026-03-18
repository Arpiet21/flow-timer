-- ── Add timezone column to user_plans ────────────────────────────────────────
-- Run this in Supabase SQL Editor

ALTER TABLE user_plans
  ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'UTC';
