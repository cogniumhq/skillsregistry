import type { EmbedderAdapter } from '@skillsregistry/domain/adapters';
import { PgVectorProvider } from '@skillsregistry/domain/providers';
import type { SqlPool } from '@skillsregistry/domain/adapters';
import { evalSeedSkills } from '@skillsregistry/eval/seed-skills';
import { truncateEmbedding, STORED_EMBEDDING_DIMS } from '../embedding/truncate.js';

export interface SeedEvalCatalogOptions {
  pool: SqlPool;
  embedder: EmbedderAdapter;
  /** Tenant scope written into `skill_embeddings`. Default `local`. */
  tenantId?: string;
  /** Log each indexed skill. */
  verbose?: boolean;
}

export interface SeedEvalCatalogResult {
  seeded: number;
  tenantId: string;
}

/**
 * Insert (or refresh) the 40 canonical eval skills with embeddings so
 * `skillsregistry-eval` can run against a freshly-provisioned local node.
 */
export async function seedEvalCatalog(
  options: SeedEvalCatalogOptions,
): Promise<SeedEvalCatalogResult> {
  const tenantId = options.tenantId ?? 'local';
  const provider = new PgVectorProvider({ pool: options.pool });
  let seeded = 0;

  for (const skill of evalSeedSkills) {
    const summaryText = skill.agentSummary;
    const raw = await options.embedder.embed(summaryText);
    const embedding = truncateEmbedding(Array.from(raw));

    await provider.index(
      {
        id: skill.id,
        name: skill.name,
        slug: skill.slug,
        version: '1.0.0',
        source: 'eval-fixture',
        description: skill.description,
        agentSummary: summaryText,
        tags: skill.tags,
        category: skill.category,
        trustScore: 0.85,
        executionLayer: 'mcp',
        tenantId,
      },
      {
        agentSummary: { text: summaryText, embedding },
        embedderIdentity: options.embedder.identity.id,
        storedDims: STORED_EMBEDDING_DIMS,
      },
    );

    if (skill.alternateQueries.length > 0) {
      await options.pool.query(
        `UPDATE skills
            SET alternate_queries = $2,
                status = 'published',
                updated_at = NOW()
          WHERE id = $1`,
        [skill.id, skill.alternateQueries],
      );
    } else {
      await options.pool.query(
        `UPDATE skills SET status = 'published', updated_at = NOW() WHERE id = $1`,
        [skill.id],
      );
    }

    seeded += 1;
    if (options.verbose) {
      console.log(`[seed:eval] indexed ${skill.slug} (${skill.id})`);
    }
  }

  return { seeded, tenantId };
}
