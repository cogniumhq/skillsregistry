-- 0035_visibility_bands.sql
-- Expand chk_visibility to the four tenant-scope bands per cortex.md §16.6.
--
-- Before: {public, private, unlisted}    (3 bands, from 0014_v52_columns)
-- After:  {public, private, tenant_private, tenant_internal, unlisted}
--
-- cortex.md §16.6:
--   "SKILLS_REGISTRY_SERVICE.search accepts tenantId filter; returns
--    public + tenant-private + tenant-internal skills."
--
-- The old 3-band model conflated "private" (single-user? tenant-wide?) into
-- one bucket. The 4-band model splits it:
--
--   public          — everyone (default)
--   private         — legacy alias, kept so pre-v6.3 rows keep parsing;
--                     new writes should prefer tenant_private
--   tenant_private  — visible to the whole tenant
--   tenant_internal — visible only to specific users within the tenant
--   unlisted        — reachable by direct ID/slug lookup but excluded
--                     from search/leaderboards
--
-- Drop-then-add is atomic inside a single ALTER TABLE (Postgres holds a
-- table-level lock briefly). No data migration — every existing row already
-- has a value in the old set, which is a strict subset of the new set.
--
-- Also: SkillVisibility zod enum in @skillsregistry/contracts is bumped in
-- lockstep (v1.2.0). Consumers that still enum-narrow on 3 values keep
-- working; consumers that want the new bands opt in with a minor bump.

ALTER TABLE skills DROP CONSTRAINT IF EXISTS chk_visibility;

ALTER TABLE skills ADD CONSTRAINT chk_visibility
  CHECK (visibility IN (
    'public',
    'private',
    'tenant_private',
    'tenant_internal',
    'unlisted'
  ));
