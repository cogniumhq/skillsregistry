#!/usr/bin/env tsx
// ══════════════════════════════════════════════════════════════════════════════
// Seed the 40 canonical eval skills into a running local Postgres catalog.
// ══════════════════════════════════════════════════════════════════════════════
//
// Usage:
//   pnpm --filter @skillsregistry/local seed:eval
//
// Requires:
//   - DATABASE_URL + Ollama (same as the local node)
//   - Migrations applied (runs bootSchema first)
//
// ══════════════════════════════════════════════════════════════════════════════

import { loadConfig } from '../src/config.js';
import { bootSchema } from '../src/boot/schema.js';
import { createPool } from '../src/db/pool.js';
import { createOllamaEmbedder } from '../src/adapters/ollama-embedder.js';
import { seedEvalCatalog } from '../src/seed/eval-seed.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.embedder.kind !== 'ollama') {
    throw new Error('seed:eval requires EMBEDDER=ollama (upstream embedder not supported yet)');
  }

  const pool = createPool(config.postgres);
  try {
    await bootSchema(pool);
    const embedder = await createOllamaEmbedder({
      url: config.embedder.url,
      model: config.embedder.model,
    });

    console.log(`[seed:eval] indexing ${40} skills for tenant=local via ${embedder.identity.id}...`);
    const result = await seedEvalCatalog({
      pool,
      embedder,
      tenantId: 'local',
      verbose: true,
    });
    console.log(`[seed:eval] done — seeded ${result.seeded} skills`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('[seed:eval] failed:', error);
  process.exit(1);
});
