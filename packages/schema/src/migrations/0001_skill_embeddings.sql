-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 0001: skill_embeddings
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Search index. Starts with 1 row per skill (agent_summary).
-- Multi-vector adds additional rows — no schema change needed.
--
-- IMPORTANT: The skills table already exists (managed by the broader Runics platform).
-- This migration creates only the search-specific tables.
--
-- ══════════════════════════════════════════════════════════════════════════════

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Main embeddings table: 1 row per embedding (1 in Phase 1, up to 6 in Phase 3)
CREATE TABLE IF NOT EXISTS skill_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  embedding vector(384) NOT NULL,
  source TEXT NOT NULL DEFAULT 'agent_summary',
  source_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT valid_source CHECK (
    source IN (
      'agent_summary',
      'alt_query_0', 'alt_query_1', 'alt_query_2',
      'alt_query_3', 'alt_query_4'
    )
  )
);

-- HNSW index for vector similarity search
-- m = 16: number of bi-directional links per node (higher = better recall, slower build)
-- ef_construction = 128: size of dynamic candidate list during construction (higher = better quality, slower build)
CREATE INDEX idx_skill_embeddings_hnsw
  ON skill_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);

-- Index for joining back to skills table
CREATE INDEX idx_skill_embeddings_skill_id
  ON skill_embeddings (skill_id);

-- Index for tenant filtering
CREATE INDEX idx_skill_embeddings_tenant_id
  ON skill_embeddings (tenant_id);

-- Full-text search on source_text
-- Stored generated column for tsvector (automatically updated)
ALTER TABLE skill_embeddings ADD COLUMN tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', source_text)) STORED;

-- GIN index for full-text search
CREATE INDEX idx_skill_embeddings_tsv ON skill_embeddings USING gin(tsv);
