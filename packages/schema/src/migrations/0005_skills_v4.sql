-- 0005_skills_v4.sql
-- Composition & Social layer: extend skills table with author, type, status,
-- fork lineage, metadata, quality signals, social counters, and editorial fields.

-- Author attribution
ALTER TABLE skills ADD COLUMN IF NOT EXISTS author_id UUID;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS author_type TEXT NOT NULL DEFAULT 'human'
  CHECK (author_type IN ('human', 'bot', 'org'));
ALTER TABLE skills ADD COLUMN IF NOT EXISTS author_bot_model TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS author_bot_prompt_hash TEXT;

-- Type and status
ALTER TABLE skills ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'skill'
  CHECK (type IN ('skill', 'composition', 'pipeline'));
ALTER TABLE skills ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published'
  CHECK (status IN ('draft', 'published', 'deprecated', 'archived'));

-- Fork lineage
ALTER TABLE skills ADD COLUMN IF NOT EXISTS fork_of UUID REFERENCES skills(id);
ALTER TABLE skills ADD COLUMN IF NOT EXISTS origin_id UUID REFERENCES skills(id);
ALTER TABLE skills ADD COLUMN IF NOT EXISTS fork_depth INTEGER DEFAULT 0;

-- Metadata (tags already exists as text[], skip it)
ALTER TABLE skills ADD COLUMN IF NOT EXISTS readme TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS categories TEXT[] DEFAULT '{}';
ALTER TABLE skills ADD COLUMN IF NOT EXISTS ecosystem TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS language TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS license TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS homepage_url TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS demo_url TEXT;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS changelog JSONB DEFAULT '[]';

-- Agent quality signals
ALTER TABLE skills ADD COLUMN IF NOT EXISTS avg_execution_time_ms REAL;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS p95_execution_time_ms REAL;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS error_rate REAL;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS agent_consumption_pattern TEXT
  CHECK (agent_consumption_pattern IN ('standalone', 'always-composed', 'mixed'));
ALTER TABLE skills ADD COLUMN IF NOT EXISTS schema_compatibility_score REAL;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS replacement_skill_id UUID REFERENCES skills(id);
ALTER TABLE skills ADD COLUMN IF NOT EXISTS adversarial_tested BOOLEAN DEFAULT FALSE;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS provenance_attested BOOLEAN DEFAULT FALSE;

-- Human social counters (human actions only — never written by agent paths)
ALTER TABLE skills ADD COLUMN IF NOT EXISTS human_star_count INTEGER DEFAULT 0;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS human_fork_count INTEGER DEFAULT 0;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS human_copy_count INTEGER DEFAULT 0;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS human_use_count INTEGER DEFAULT 0;

-- Agent counters (agent invocations only — never written by human social paths)
ALTER TABLE skills ADD COLUMN IF NOT EXISTS agent_invocation_count BIGINT DEFAULT 0;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS agent_fork_count INTEGER DEFAULT 0;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS composition_inclusion_count INTEGER DEFAULT 0;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS dependent_count INTEGER DEFAULT 0;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS weekly_agent_invocation_count INTEGER DEFAULT 0;

-- Editorial
ALTER TABLE skills ADD COLUMN IF NOT EXISTS featured BOOLEAN DEFAULT FALSE;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS verified_creator BOOLEAN DEFAULT FALSE;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS collection_ids UUID[] DEFAULT '{}';

-- Lifecycle
ALTER TABLE skills ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE skills ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_skills_tags ON skills USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_skills_categories ON skills USING gin(categories);
CREATE INDEX IF NOT EXISTS idx_skills_fork_of ON skills(fork_of);
CREATE INDEX IF NOT EXISTS idx_skills_origin_id ON skills(origin_id);
CREATE INDEX IF NOT EXISTS idx_skills_author_id ON skills(author_id);
CREATE INDEX IF NOT EXISTS idx_skills_type ON skills(type);
CREATE INDEX IF NOT EXISTS idx_skills_weekly_invocations ON skills(weekly_agent_invocation_count DESC);
CREATE INDEX IF NOT EXISTS idx_skills_human_stars ON skills(human_star_count DESC);
