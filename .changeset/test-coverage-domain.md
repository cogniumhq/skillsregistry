---
"@skillsregistry/domain": patch
---

Unit test coverage across all six domain sub-modules. 341 new tests:

- **scoring/policy** — 98 tests, 100% coverage. All finding types,
  D2 signature bonus/revocation, tier boundaries, cascade impact.
- **ingestion/text-fingerprint** — 19 tests, 100% coverage. Web
  Crypto SHA-256 across empty/short/long/binary inputs.
- **providers/pgvector-{fusion,search,index}** — 82 tests, 95.67%
  coverage. Fusion weights, SqlPool query-shape assertions,
  distance-metric round-trips.
- **intelligence** — 65 tests, 95.72% coverage. Confidence-gate
  tier classification with `SKIP_RERANKER_GAP`, deep-search T3 rescue,
  reranker fan-in, backend fetch with undici MockAgent.
- **composition** — 77 tests, 91.6% coverage. Fork / copy / compose /
  extend / publish / lineage / get-composition all through the SqlPool
  + QueueAdapter port.

Package now above the 90% publish gate.
