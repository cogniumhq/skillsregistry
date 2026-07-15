// ══════════════════════════════════════════════════════════════════════════════
// discovery — descriptor shape + origin resolution
// ══════════════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';

import { buildDiscoveryDescriptor } from './discovery.js';
import { resolveConfig } from './protocol.js';

describe('buildDiscoveryDescriptor', () => {
  it('emits schemaVersion + protocolVersion + tools list', () => {
    const d = buildDiscoveryDescriptor({
      requestUrl: new URL('https://api.skillsregistry.net/mcp.json'),
      config: resolveConfig(undefined),
    });
    expect(d).toMatchObject({
      schemaVersion: '1',
      protocolVersion: '2025-03-26',
      transport: {
        type: 'streamable-http',
        endpoint: 'https://api.skillsregistry.net/mcp',
        methods: ['POST'],
      },
      capabilities: { tools: { listChanged: false } },
      auth: { model: 'none', tenantHeader: 'X-Tenant-Id' },
    });
    const tools = (d.tools as { name: string }[]).map((t) => t.name);
    expect(tools).toHaveLength(5);
  });

  it('prefers canonicalOrigin over the request URL', () => {
    const d = buildDiscoveryDescriptor({
      requestUrl: new URL('https://skillsregistry.workers.dev/mcp.json'),
      config: resolveConfig({ canonicalOrigin: 'https://api.skillsregistry.net' }),
    });
    expect(d.transport).toMatchObject({
      endpoint: 'https://api.skillsregistry.net/mcp',
    });
  });

  it('strips trailing slash from canonicalOrigin', () => {
    const d = buildDiscoveryDescriptor({
      config: resolveConfig({ canonicalOrigin: 'https://api.skillsregistry.net/' }),
    });
    expect((d.transport as { endpoint: string }).endpoint).toBe(
      'https://api.skillsregistry.net/mcp',
    );
  });

  it('surfaces documentation + openapi overrides', () => {
    const d = buildDiscoveryDescriptor({
      config: resolveConfig({
        canonicalOrigin: 'https://api.skillsregistry.net',
        documentationUrl: 'https://docs.example.com',
        openapiUrl: 'https://api.example.com/openapi.json',
      }),
    });
    expect(d.documentation).toBe('https://docs.example.com');
    expect(d.openapi).toBe('https://api.example.com/openapi.json');
  });
});
