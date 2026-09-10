---
"@skillsregistry/contracts": minor
---

Admin skill mutation contracts for the local node (#83 / #84). Additive, no existing field changed: `AdminSkillStatusSchema` (the operator-settable lifecycle subset — `draft` / `published` / `deprecated` / `archived`, deliberately excluding platform-set states like `revoked` and `vulnerable`), `AdminSkillPatchRequestSchema` + `AdminSkillPatchResponseSchema` for the status transition, and `AdminSkillDeleteResponseSchema` for the hard delete (reports `embeddingsRemoved` so the caller can see what the cascade took). Manifest fields stay immutable by construction — `POST /v1/skills` is INSERT-only and `UNIQUE (slug, version)` means a corrected manifest is a new version, not an edit of history.
