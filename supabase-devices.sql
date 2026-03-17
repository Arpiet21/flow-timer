-- ── User Devices Table ────────────────────────────────────────────────────────
-- Restricts each account to a maximum of 2 active devices (browsers).
-- Run this in Supabase → SQL Editor

CREATE TABLE IF NOT EXISTS user_devices (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id   text        NOT NULL,
  device_name text,                             -- e.g. "Chrome on Windows"
  last_seen   timestamptz DEFAULT now(),
  created_at  timestamptz DEFAULT now(),
  UNIQUE(user_id, device_id)
);

ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;

-- Users can read their own device list (needed for count checks client-side)
CREATE POLICY "Read own devices"
  ON user_devices FOR SELECT
  USING (auth.uid() = user_id);

-- Users can add a new device only if they have fewer than 2 already
-- This is the hard DB-level enforcement (client-side check is first line of defence)
CREATE POLICY "Max 2 devices per user"
  ON user_devices FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    (SELECT COUNT(*) FROM user_devices WHERE user_id = auth.uid()) < 2
  );

-- Users can refresh last_seen for their own devices
CREATE POLICY "Update own devices"
  ON user_devices FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can remove their own devices (on sign out)
CREATE POLICY "Delete own devices"
  ON user_devices FOR DELETE
  USING (auth.uid() = user_id);
