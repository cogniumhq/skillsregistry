import { evalCanonicalSkillIds, evalFixtures } from './fixtures.js';

export interface EvalSeedSkill {
  id: string;
  slug: string;
  name: string;
  description: string;
  agentSummary: string;
  tags: string[];
  category: string;
  alternateQueries: string[];
}

const CATEGORY_BY_KEY: Partial<Record<keyof typeof evalCanonicalSkillIds, string>> = {
  CARGO_DENY: 'security',
  TRIVY: 'security',
  SEMGREP: 'security',
  SNYK: 'security',
  CODEQL: 'security',
  LICENSE_CHECKER: 'compliance',
  FOSSA: 'compliance',
  PRETTIER: 'formatting',
  ESLINT: 'linting',
  BIOME: 'linting',
  BLACK: 'formatting',
  DOCKER_POSTGRES: 'database',
  REDIS: 'database',
  MYSQL: 'database',
  MONGODB: 'database',
  DRIZZLE_MIGRATE: 'database',
  PANDOC: 'documentation',
  TYPEDOC: 'documentation',
  STORYBOOK: 'documentation',
  TERRAFORM: 'infrastructure',
  KUBECTL: 'infrastructure',
  CLOUDFLARE_DEPLOY: 'infrastructure',
  DOCKER_BUILD: 'containers',
  DOCKERFILE_LINT: 'containers',
  HADOLINT: 'containers',
  PROMETHEUS: 'observability',
  GRAFANA: 'observability',
  DATADOG: 'observability',
  POSTMAN: 'api',
  HTTPIE: 'api',
  REST_CLIENT: 'api',
  JEST: 'testing',
  PLAYWRIGHT: 'testing',
  K6: 'testing',
  GIT_HOOKS: 'developer-experience',
  COMMITLINT: 'developer-experience',
  SEMANTIC_RELEASE: 'developer-experience',
  SWAGGER_CODEGEN: 'api',
  CLIPPY: 'rust',
  DEPENDABOT: 'security',
};

function skillKeyToSlug(key: string): string {
  return key.toLowerCase().replace(/_/g, '-');
}

function skillKeyToName(key: string): string {
  return key
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

function inferTags(key: string, slug: string): string[] {
  const tags = new Set<string>(['eval-fixture', slug]);
  if (key.includes('DOCKER')) tags.add('docker');
  if (key.includes('TEST') || ['JEST', 'PLAYWRIGHT', 'K6'].includes(key)) {
    tags.add('testing');
  }
  return [...tags];
}

/**
 * Build the 40 canonical eval catalog entries from fixture metadata.
 * Each skill gets fixture queries folded into `agentSummary` / `alternateQueries`
 * so local vector + FTS search can retrieve them after `seed:eval`.
 */
export function buildEvalSeedSkills(): EvalSeedSkill[] {
  const queriesBySkill = new Map<string, string[]>();
  for (const fixture of evalFixtures) {
    const list = queriesBySkill.get(fixture.expectedSkillId) ?? [];
    list.push(fixture.query);
    queriesBySkill.set(fixture.expectedSkillId, list);
  }

  return Object.entries(evalCanonicalSkillIds).map(([key, id]) => {
    const slug = skillKeyToSlug(key);
    const name = skillKeyToName(key);
    const queries = queriesBySkill.get(id) ?? [];
    const uniqueQueries = [...new Set(queries)];
    const category =
      CATEGORY_BY_KEY[key as keyof typeof evalCanonicalSkillIds] ?? 'tools';

    return {
      id,
      slug,
      name,
      description: `${name} — canonical SkillsRegistry eval fixture skill.`,
      agentSummary: `${name}. ${uniqueQueries.slice(0, 8).join(' ')}`,
      tags: inferTags(key, slug),
      category,
      alternateQueries: uniqueQueries.slice(1),
    };
  });
}

export const evalSeedSkills = buildEvalSeedSkills();
