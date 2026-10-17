---
"@skillsregistry/domain": patch
---

PgVectorProvider.index() writes workflow_definition on the skill upsert. Reindexing a composite reuses the stored definition so chk_composite_requires_workflow does not reject the proposed INSERT.
