---
'@skillsregistry/contracts': minor
---

Ship the revocation-event surface per cortex.md §12. Consumers (Cortex, local nodes, third-party agents) build against these shapes to receive `skill.revoked` / `skill.deprecated` events via webhook or `GET /v1/sync/revocations?since=<ISO>`:

- `SkillRevocationEventSchema` — `{ event_id, event_type, emitted_at, skill_id, slug, version?, reason, reason_detail?, remediation_message?, remediation_url?, replacement_skill_id?, replacement_slug? }`
- `SkillRevocationReasonSchema` — enum: `security | compliance | policy | quality | author_request | superseded | unknown`
- `SkillRevocationEventTypeSchema` — enum: `skill.revoked | skill.deprecated`
- `SkillRevocationSyncResponseSchema` — cursor-paginated pull response, mirrors `TrustScoreSyncResponseSchema` so consumers can share a delta-pull scaffold

Wire naming is snake_case for parity with the rest of the upstream API. Local-node webhook wiring is a follow-up; the contracts are the load-bearing prerequisite.

Closes review finding S7 (contracts side).
