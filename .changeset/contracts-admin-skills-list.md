---
"@skillsregistry/contracts": patch
---

Add `AdminSkillsListResponseSchema` for the local node's admin UI skills +
migration pages (T-3.4 / T-3.6). Minimal projection of the `skills` table:
`id`, `slug`, `name`, `source`, `version`, `mothershipPublishStatus`,
`mothershipUrl`, `mothershipPublishedAt`, `createdAt`. Mothership fields are
populated only on the local node — the mothership itself never emits them.

The response envelope wraps the list with `total`, `limit`, `offset` so the UI
can render a paginated "X of N" caption without a second round-trip. This is
additive; existing schemas are untouched.

Publish is deferred until Phase 3 fully lands.
