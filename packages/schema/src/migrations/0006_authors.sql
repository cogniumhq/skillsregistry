-- 0006_authors.sql
-- First-class author identity for humans and bots.

CREATE TABLE IF NOT EXISTS authors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle TEXT UNIQUE NOT NULL,              -- @eyal | @cortex-forge-bot
  display_name TEXT,
  author_type TEXT NOT NULL DEFAULT 'human'
    CHECK (author_type IN ('human', 'bot', 'org')),
  bio TEXT,
  avatar_url TEXT,
  homepage_url TEXT,

  -- Bot-specific fields
  bot_model TEXT,                           -- model that powers this bot author
  bot_operator_id UUID,                     -- human/org that owns this bot

  -- Social stats (human leaderboard)
  total_skills_published INTEGER DEFAULT 0,
  total_human_stars_received INTEGER DEFAULT 0,
  total_human_forks_received INTEGER DEFAULT 0,
  verified BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_authors_handle ON authors(handle);
CREATE INDEX IF NOT EXISTS idx_authors_type ON authors(author_type);

-- User stars join table (human-only social action)
CREATE TABLE IF NOT EXISTS user_stars (
  user_id UUID NOT NULL,
  skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_user_stars_user ON user_stars(user_id);
CREATE INDEX IF NOT EXISTS idx_user_stars_skill ON user_stars(skill_id);
CREATE INDEX IF NOT EXISTS idx_user_stars_created ON user_stars(created_at);
