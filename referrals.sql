-- ── Referrals table ──────────────────────────────────────────────────────────
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS referrals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referee_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referral_code text NOT NULL,          -- 6-char code of the referrer
  rewarded      boolean DEFAULT false,  -- set true after bonus is granted
  created_at    timestamptz DEFAULT now(),
  UNIQUE (referee_id)                   -- one referral per account
);

-- Enable RLS
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- Users can insert their own referral (signup flow)
CREATE POLICY "insert own referral"
  ON referrals FOR INSERT
  WITH CHECK (auth.uid() = referee_id);

-- Users can read referrals where their code was used (to count them)
CREATE POLICY "read referrals by code"
  ON referrals FOR SELECT
  USING (
    referral_code = (
      SELECT UPPER(REPLACE(id::text, '-', '')) FROM auth.users WHERE id = auth.uid() LIMIT 1
    )::varchar(6)
    OR auth.uid() = referee_id
  );
