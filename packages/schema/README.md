# @skillsregistry/schema

Drizzle schema + migration runner for the SkillsRegistry data model.

**License:** Apache-2.0. This package is shared between the open-source
[skillsregistry-local](https://github.com/cogniumhq/skillsregistry-local)
node and the proprietary mothership at `api.skillsregistry.net`. Both
consume the same schema so migrations and column layouts never drift.

## What's in the box

- **Drizzle table definitions** — `schema.skills`, `schema.skillEmbeddings`,
  `schema.compositions`, `schema.invocations`, `schema.publisherKeys`,
  `schema.mcpInvocations`, `schema.searchLogs`, and the rest of the data
  model. Import the ones you need for type-safe queries.
- **32 SQL migrations** (`0001` → `0032`) bundled inside the package.
- **A runtime-agnostic migration runner** — accepts any client with
  `query(sql, values)`. Works with `pg`, `pg-pool`, and
  `@neondatabase/serverless`.
- **`SCHEMA_VERSION` constant** — the highest migration number bundled
  in this SDK version. Fail-fast if the DB is behind.

## Install

```bash
npm install @skillsregistry/schema
# or
pnpm add @skillsregistry/schema
```

`pg` is a peer dependency (optional) — install it if you're going to
use `runMigrations()` via node-postgres:

```bash
pnpm add pg
```

## Usage

### Type-safe queries

```ts
import { schema } from '@skillsregistry/schema';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';

const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }));

const [row] = await db
  .select()
  .from(schema.skills)
  .where(eq(schema.skills.slug, 'anthropic-claude-code'));
```

### Boot-time migration + version check

```ts
import { Pool } from 'pg';
import {
  loadBundledMigrations,
  runMigrations,
  assertSchemaAtLeast,
  SCHEMA_VERSION,
} from '@skillsregistry/schema';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

const migrations = await loadBundledMigrations();
const { applied, skipped, finalVersion } = await runMigrations(
  client,
  migrations,
);
console.log(
  `[schema] applied ${applied.length}, skipped ${skipped.length}, at v${finalVersion}`,
);

await assertSchemaAtLeast(client, SCHEMA_VERSION);
client.release();
```

## Design intent

**Runtime-agnostic.** No `Env`, no Cloudflare bindings, no Node globals
in the public API. The migration runner takes a client interface, not a
driver.

**Append-only migrations.** Numbers never repeat, files are never edited
after landing. To change something old, add a new migration.

**Version pinning.** Downstream consumers (mothership, local node) pin
exact versions — `"1.0.0"`, not `"^1.0.0"`. Breaking changes bump the
major.

## Semver rules

- **Major** (`2.0.0`): renaming or dropping a column, dropping a table,
  renaming an exported Drizzle table binding
- **Minor** (`1.1.0`): adding a table, adding a nullable column, adding
  a new migration file
- **Patch** (`1.0.1`): docstring fixes, README, dep bumps that don't
  affect exports

## License

Apache-2.0 — see [LICENSE](../../LICENSE) in the monorepo root.
