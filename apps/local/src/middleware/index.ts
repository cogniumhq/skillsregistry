// ══════════════════════════════════════════════════════════════════════════════
// Hono middleware surface.
// ══════════════════════════════════════════════════════════════════════════════

export { adminAuth } from './admin-auth.js';
export type { AdminAuthOptions } from './admin-auth.js';
export { getTenantId, tenantContext } from './tenant.js';
