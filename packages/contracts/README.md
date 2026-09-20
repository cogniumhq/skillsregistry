# @skillsregistry/contracts

Zod schemas + TypeScript types for the SkillsRegistry public API and the
local-node ↔ mothership contract.

**License:** Apache-2.0. Consumed by both the open-source
[SkillsRegistry local](https://github.com/cogniumhq/skillsregistry)
node and the proprietary mothership. Both sides pin the exact same
version so no field ever silently drifts.

## Modules

| Import | Purpose |
|---|---|
| `@skillsregistry/contracts` | Everything below re-exported |
| `@skillsregistry/contracts/common` | Shared OpenAPI path + query params (`SkillIdParam`, `SkillSlugParam`, `LimitQuery`, …). Depends on `@hono/zod-openapi`. |
| `@skillsregistry/contracts/responses` | HTTP response envelopes for public REST routes. Depends on `@hono/zod-openapi`. |
| `@skillsregistry/contracts/upstream` | Local-node → mothership contract: trust scoring, budget, publish, delta sync, error taxonomy. Plain `zod` — no OpenAPI meta. |

## Install

```bash
pnpm add @skillsregistry/contracts
```

## Example — upstream client

```ts
import {
  TrustScoreRequestSchema,
  TrustScoreResponseSchema,
  UpstreamErrorSchema,
  type UpstreamErrorCode,
} from '@skillsregistry/contracts/upstream';

const body = TrustScoreRequestSchema.parse({ skill_id: mySkillId });
const res = await fetch(`${MOTHERSHIP_URL}/v1/trust/score`, {
  method: 'POST',
  headers: {
    'authorization': `Bearer ${API_KEY}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify(body),
});

if (!res.ok) {
  const err = UpstreamErrorSchema.parse(await res.json());
  handleUpstreamError(err.error.code, err.error.retry_after);
  return;
}

const scored = TrustScoreResponseSchema.parse(await res.json());
```

## Design intent

**Plain zod for upstream.** The upstream contracts (`./upstream`) use bare
`zod` so consumers can validate without pulling `@hono/zod-openapi`. The
HTTP-response contracts stay on `@hono/zod-openapi` because that's where
mothership generates its OpenAPI doc.

**Field-name stability.** Every field name in this package is a public
contract. Renaming a field is a MAJOR bump. Adding a nullable field is a
MINOR bump. Docstring changes are a PATCH.

## Semver rules

- **Major** (`2.0.0`): rename or remove any request/response field;
  change the enum values of `UpstreamErrorCode`
- **Minor** (`1.1.0`): add a new endpoint's schemas; add a nullable
  request field; add a new `UpstreamErrorCode` value
- **Patch** (`1.0.1`): docstring updates, README

## License

Apache-2.0 — see [LICENSE](../../LICENSE) in the monorepo root.
