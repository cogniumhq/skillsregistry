// ══════════════════════════════════════════════════════════════════════════════
// MCP discovery descriptor
// ══════════════════════════════════════════════════════════════════════════════
//
// Verbatim port of mothership `buildDiscoveryDescriptor()`. Served at two
// paths by consumers:
//   - `/.well-known/mcp.json` (RFC 8615 well-known path; preferred)
//   - `/mcp.json`             (root-level alias; some early clients look here)
//
// The current MCP spec doesn't formalize a discovery URL. This descriptor is a
// server-derived view of what `tools/list` would return, plus enough metadata
// for a client to point its MCP transport at us without a round-trip. No
// tenant scoping — the catalog of *what tools exist* is public; the data
// returned by those tools is what honors `X-Tenant-Id`.
// ══════════════════════════════════════════════════════════════════════════════

import type { ResolvedMcpConfig } from './types.js';
import { MCP_PROTOCOL_VERSION } from './protocol.js';
import { TOOLS } from './tools/index.js';

export interface DiscoveryDescriptorInput {
  /**
   * Fallback origin (typically the incoming request URL) used when
   * `config.canonicalOrigin` is not set. Consumers pass their request URL
   * so descriptors served from workers.dev / preview hostnames still work.
   */
  requestUrl?: URL | string;
  config: ResolvedMcpConfig;
}

export function buildDiscoveryDescriptor(
  input: DiscoveryDescriptorInput,
): Record<string, unknown> {
  // Prefer the configured canonical origin so descriptors served from
  // `*.workers.dev` or legacy aliases still point clients at the public
  // production hostname. Falls back to the request URL when unset.
  const origin = resolveOrigin(input);
  return {
    schemaVersion: '1',
    protocolVersion: MCP_PROTOCOL_VERSION,
    serverInfo: {
      name: input.config.serverName,
      version: input.config.serverVersion,
    },
    transport: {
      type: 'streamable-http',
      endpoint: `${origin}/mcp`,
      methods: ['POST'],
    },
    capabilities: { tools: { listChanged: false } },
    auth: {
      // v1 read-only — `X-Tenant-Id` is an advisory scope hint, not a security
      // boundary. OAuth 2.1 + RFC 8707 ships with v2 write tools.
      model: 'none',
      tenantHeader: 'X-Tenant-Id',
      notes:
        'v1 tools are read-only and public. Pass X-Tenant-Id to union your private overlay with the public catalog. Spoofed / missing headers degrade to public-only.',
    },
    tools: TOOLS.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
    documentation: input.config.documentationUrl ?? `${origin}/docs`,
    openapi: input.config.openapiUrl ?? `${origin}/openapi.json`,
  };
}

function resolveOrigin(input: DiscoveryDescriptorInput): string {
  const canonical = input.config.canonicalOrigin;
  if (canonical && canonical.length > 0) return canonical.replace(/\/$/, '');
  if (!input.requestUrl) return '';
  const url =
    input.requestUrl instanceof URL ? input.requestUrl : new URL(input.requestUrl);
  return `${url.protocol}//${url.host}`;
}
