# skillsregistry — the risk map

| path | a mistake costs | how to review |
|---|---|---|
| `packages/*` | npm SDK consumers | **deep** |
| `apps/local/` | self-hosted node | **deep** — tokens, air-gap |
| publish workflows | npm/app releases | **REQUEST_CHANGES, owner** |
| `.github/workflows/` | changeset + SAST gates | **REQUEST_CHANGES, owner** |

## What ships broken here

- Trust copy implying unscanned = safe.
- Missing changeset on `packages/*` PRs.
- MCP/HTTP contract drift with Cortex and public API.

## Who decides

- Trust policy and majors: **owner**.