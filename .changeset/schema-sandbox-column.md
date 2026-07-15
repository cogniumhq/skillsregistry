---
'@skillsregistry/schema': minor
---

Add top-level `sandbox jsonb` column via migration `0034_sandbox_contract.sql` and bump `SCHEMA_VERSION` 33 → 34. Additive, no data migration; pre-v1.3 `agent_profile` column stays in place per append-only. The new column carries the skill-convention v1.3 §9 sandbox contract (`image`, `memory_mb`, `cpu`, `timeout_seconds`, `egress[]`, plus optional `profile` + `budget_caps` for agent skills) — validated at ingest by `SkillSandboxSchema` in `@skillsregistry/contracts`. Applies to every runtime_env with a sandbox surface (vm + agent + api). Unblocks per-skill Lane 0 image pinning.
