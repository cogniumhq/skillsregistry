---
'@skillsregistry/contracts': minor
---

Ship `SkillSandboxSchema` + `SkillSandbox` type per skill-convention v1.3 §9. Fields: `image` (required, non-empty), `memory_mb` / `cpu` / `timeout_seconds` (positive ints), `egress: string[]`, optional `profile: 'agent'` + `budget_caps: { max_tokens_usd?, max_internal_tool_calls?, max_wall_seconds? }`. Wired into `PublishRequestSchema.manifest` as an optional field so pre-v1.3 rows still parse. Also adds `sandbox_contract_violated` to `UpstreamErrorCode` (and the `UpstreamErrorSchema` enum) — a distinct code for exit-90 sandbox failures (skill-convention §9.2) that keeps them out of the generic `bad_request` / `upstream_unavailable` buckets so operators see a named, actionable cause.
