---
"@skillsregistry/domain": minor
---

New policy-bucket taxonomy with a `dual-use` value for offensive-security / pentest frameworks (#105). `POLICY_BUCKETS`, `PolicyBucket` and `isPolicyBucket(value)` are exported from `@skillsregistry/domain/scoring`. Taxonomy only: no skill is assigned a bucket here (assignments belong in registry data), and trust math and status derivation are unchanged.
