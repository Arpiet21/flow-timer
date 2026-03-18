-- ── Teams tables ─────────────────────────────────────────────────────────────
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  invite_code text NOT NULL UNIQUE,
  created_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  joined_at  timestamptz DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

-- Enable RLS
ALTER TABLE teams        ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- ── teams policies ────────────────────────────────────────────────────────────
-- Anyone can look up a team by invite_code (needed for join flow)
CREATE POLICY "read team by code"
  ON teams FOR SELECT
  USING (true);

-- Only the creator can insert
CREATE POLICY "create own team"
  ON teams FOR INSERT
  WITH CHECK (auth.uid() = created_by);

-- ── team_members policies ──────────────────────────────────────────────────────
-- Members can see their own team's members
CREATE POLICY "read own team members"
  ON team_members FOR SELECT
  USING (
    team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
  );

-- Users can insert themselves as a member
CREATE POLICY "join team"
  ON team_members FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete themselves (leave team)
CREATE POLICY "leave team"
  ON team_members FOR DELETE
  USING (auth.uid() = user_id);
