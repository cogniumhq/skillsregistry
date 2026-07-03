---
"@skillsregistry/mcp": patch
---

Unit test coverage for all five MCP tools + the invocation writer.
70 new tests, 96.18% overall coverage:

- **tools/search-skills** — 15 tests. Query length validation,
  options passthrough (limit clamp, runtimeEnv wrap, tags/portable/
  category filters), envelope verbatim from `SearchGatewayPort`.
- **tools/get-skill** — 8 tests. Slug + optional version validation,
  not-found isError envelope, `resolvedSkillId` stamp on success.
- **tools/get-trust-breakdown** — 7 tests. Trust-only allowlist
  projection (~28 fields kept, non-trust fields stripped).
- **tools/list-leaderboard** — 15 tests. Kind allowlist enum
  validation for all 5 kinds, limit clamping, filter passthrough.
- **tools/resolve-composition** — 6 tests. Slug validation,
  composition-detail passthrough with resolvedSkillId stamp.
- **invocation-writer** — 19 tests. 7-param `mcp_invocations` INSERT
  shape with `$7::jsonb` cast, durationMs floor/round, args JSON
  truncation with `{_truncated:true, raw:slice}` marker, unserializable
  circular-ref fallback, skills counter bump matrix for
  `SKILL_RESOLVING_TOOLS`, error swallow with injected logger and
  console.error fallback.

Package now above the 96% publish gate.
