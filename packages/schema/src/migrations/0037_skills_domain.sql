-- 0037_skills_domain.sql
-- Add the derived application-domain facet column to `skills`.
--
-- The mothership already carries `skills.domain TEXT` (derived by the
-- heuristic classifier next to `category`; feeds the `domain` facet on
-- `GET /v1/skills` and `POST /v1/search`). The shared schema did not, so
-- `@skillsregistry/domain` could not express a `domains` filter without
-- referencing a column that only exists on one side — a violation of
-- "`@skillsregistry/schema` is the single physical shape". Local nodes
-- leave it NULL until a classifier runs; the filter simply matches nothing.
--
-- Append-only, idempotent. Pairs with `SCHEMA_VERSION` 36 → 37.

ALTER TABLE skills ADD COLUMN IF NOT EXISTS domain TEXT;

CREATE INDEX IF NOT EXISTS idx_skills_domain ON skills (domain);
